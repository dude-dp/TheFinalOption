// ============================================
// Hono API Routes — TheFinalOption MTF Screener & Portfolio
// ============================================

import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../lib/types';
import { KV_KEYS } from '../lib/types';
import { 
  getAuthorizationUrl, 
  exchangeCodeForToken, 
  getRawFunds, 
  getPositions, 
  getHoldings, 
  getOrderBook 
} from '../lib/upstox';
import { handleScheduled, resolveAccessToken } from '../cron';
import { generateStockCatalyst } from '../lib/ai-catalyst';
import { getISTComponents, isMarketOpen, getCurrentIST } from '../lib/time';

const api = new Hono<{ Bindings: Env }>();

const dashboardAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    c.header('WWW-Authenticate', 'Basic realm="TheFinalOption"');
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const match = authHeader.match(/^Basic\s+(.*)$/i);
  if (!match) {
    c.header('WWW-Authenticate', 'Basic realm="TheFinalOption"');
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  try {
    const decoded = atob(match[1]);
    const [username, password] = decoded.split(':');
    if (username === 'vdineshprabu' && password === 'Healthywealth007#') {
      await next();
    } else {
      c.header('WWW-Authenticate', 'Basic realm="TheFinalOption"');
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } catch (e) {
    c.header('WWW-Authenticate', 'Basic realm="TheFinalOption"');
    return c.json({ error: 'Unauthorized' }, 401);
  }
};

// Apply Basic Auth to protected routes
api.use('/api/status', dashboardAuth);
api.use('/api/summary', dashboardAuth);
api.use('/api/mtf-screener', dashboardAuth);
api.use('/api/mtf-screener/*', dashboardAuth);
api.use('/api/mtf-portfolio', dashboardAuth);
api.use('/api/morning-briefing', dashboardAuth);
api.use('/api/logs', dashboardAuth);
api.use('/api/portfolio/*', dashboardAuth);
api.use('/api/upstox/*', dashboardAuth);
api.use('/api/screener/*', dashboardAuth);

async function getUpstoxAccessToken(c: any): Promise<string | null> {
  try {
    if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_KEY) return null;
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('system_state')
      .select('upstox_access_token')
      .eq('id', 1)
      .single();
    if (error || !data) return null;
    return data.upstox_access_token || null;
  } catch (err) {
    console.error('[DB ERR] Failed to fetch upstox access token from Supabase:', err);
    return null;
  }
}

// =====================
// SYSTEM LOGS & STATUS
// =====================

/**
 * GET /api/logs
 * Returns the latest system_logs rows from Supabase.
 */
api.get('/api/logs', async (c) => {
  if (!c.env.SUPABASE_SERVICE_KEY) {
    return c.json({ logs: [], count: 0, warning: "SUPABASE_SERVICE_KEY secret missing on Cloudflare" });
  }
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('system_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[DB ERR] Supabase system_logs fetch failed:', error.message);
      return c.json({ logs: [], count: 0, error: error.message });
    }

    return c.json({ logs: data || [], count: data?.length || 0 });
  } catch (err: any) {
    console.error('[API ERR] Logs endpoint crash:', err.message);
    return c.json({ logs: [], count: 0, error: err.message });
  }
});

/** GET /api/status — MTF Screener & System status */
api.get('/api/status', async (c) => {
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);
    const { data: sysState, error } = await supabase
      .from('system_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !sysState) {
      return c.json({ error: error?.message || 'State record unallocated.' }, 500);
    }

    return c.json({
      status: 'ACTIVE',
      lastUpdated: sysState.updated_at,
      hasAccessToken: !!sysState.upstox_access_token,
      engine: 'Cloudflare Cron Pipeline'
    });
  } catch (err: any) {
    return c.json({ error: `Failed to compile status: ${err.message}` }, 500);
  }
});

// =====================
// OAUTH ENDPOINTS
// =====================

/** GET /api/auth/login — Redirect to Upstox OAuth */
api.get('/api/auth/login', (c) => {
  const url = getAuthorizationUrl(c.env.UPSTOX_CLIENT_ID, c.env.UPSTOX_REDIRECT_URI);
  return c.redirect(url);
});

/** GET /oauth/callback — Handle Upstox OAuth callback */
api.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  try {
    const { accessToken } = await exchangeCodeForToken(
      code,
      c.env.UPSTOX_CLIENT_ID,
      c.env.UPSTOX_CLIENT_SECRET,
      c.env.UPSTOX_REDIRECT_URI
    );

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    await supabase.from('system_state').update({
      upstox_access_token: accessToken,
      updated_at: new Date().toISOString()
    }).eq('id', 1);

    try {
      await c.env.TRADING_KV.put(KV_KEYS.UPSTOX_ACCESS_TOKEN, accessToken);
    } catch (e: any) {
      console.warn('[KV ERR] Failed to store upstox_access_token in KV:', e.message);
    }

    return c.redirect('/');
  } catch (e: any) {
    return c.text(`Auth failed: ${e.message}`, 500);
  }
});

// =====================
// MTF SCREENER ENDPOINTS
// =====================

/**
 * GET /api/mtf-screener
 * Serves active quantitative MTF setups cached in Supabase mtf_screened_stocks table.
 */
api.get('/api/mtf-screener', async (c) => {
  if (!c.env.SUPABASE_SERVICE_KEY) {
    return c.json({ success: true, count: 0, data: [], warning: "SUPABASE_SERVICE_KEY secret not configured on Cloudflare" });
  }
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    
    const { data, error } = await supabase
      .from('mtf_screened_stocks')
      .select('*')
      .order('conviction', { ascending: false })
      .order('macd_value', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[SUPABASE ERR] /api/mtf-screener:', error.message);
      return c.json({ success: true, count: 0, data: [], warning: error.message });
    }

    return c.json({ success: true, count: data?.length || 0, data: data || [] });
  } catch (err: any) {
    console.error('[EXCP ERR] /api/mtf-screener:', err?.message);
    return c.json({ success: true, count: 0, data: [], warning: err?.message || 'Unknown error' });
  }
});

/**
 * GET/POST /api/mtf-screener/trigger
 * Triggers an on-demand MTF scan immediately.
 */
api.on(['GET', 'POST'], '/api/mtf-screener/trigger', async (c) => {
  try {
    const accessToken = await resolveAccessToken(c.env);
    if (!accessToken) {
      return c.json({ 
        success: false, 
        error: "No active Upstox access token found in KV or Supabase. Please re-authenticate Upstox." 
      }, 400);
    }

    c.executionCtx.waitUntil(handleScheduled(c.env, true));
    return c.json({ success: true, message: "On-demand MTF scan triggered successfully." });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * POST /api/mtf-screener/analyze-catalyst
 * On-demand AI Catalyst & News Analysis powered by Groq (Llama-3.3-70B)
 */
api.post('/api/mtf-screener/analyze-catalyst', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const symbol = body.symbol || body.tradingsymbol;
    if (!symbol) {
      return c.json({ success: false, error: "Symbol is required" }, 400);
    }

    const price = Number(body.price || body.current_price || 0);
    const sector = body.sector || 'General';
    const primarySignal = body.primarySignal || body.macd_signal || 'TIGHT_BASE_SQUEEZE';
    const macdValue = body.macdValue !== undefined ? Number(body.macdValue) : body.macd_value !== undefined ? Number(body.macd_value) : 0;
    const rsi = body.rsi !== undefined ? Number(body.rsi) : body.rsi_14 !== undefined ? Number(body.rsi_14) : 50;
    const adx = body.adx !== undefined ? Number(body.adx) : body.adx_trend !== undefined ? Number(body.adx_trend) : 25;
    const rvol = body.rvol !== undefined ? Number(body.rvol) : 1;
    const atr = body.atr !== undefined ? Number(body.atr) : body.atr_value !== undefined ? Number(body.atr_value) : 0;
    const vwapDist = body.vwapDist !== undefined ? Number(body.vwapDist) : body.distance_from_vwap_pct !== undefined ? Number(body.distance_from_vwap_pct) : 0;
    const conviction = body.conviction || 'HIGH';

    const result = await generateStockCatalyst(c.env, symbol, {
      price,
      sector,
      primarySignal,
      macdValue,
      rsi,
      adx,
      rvol,
      atr,
      vwapDist,
      conviction
    });

    if (c.env.SUPABASE_SERVICE_KEY) {
      c.executionCtx.waitUntil((async () => {
        try {
          const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
          await supabase
            .from('mtf_screened_stocks')
            .update({
              ai_catalyst: result.catalyst,
              catalyst_sentiment: result.sentiment,
              updated_at: new Date().toISOString()
            })
            .eq('tradingsymbol', symbol);
        } catch {
          // ignore async update errors
        }
      })());
    }

    return c.json({
      success: true,
      symbol,
      ...result
    });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || 'Failed to analyze catalyst' }, 500);
  }
});

/**
 * GET /api/mtf-portfolio
 * Serves live synchronized MTF active positions and trailing SLs.
 */
api.get('/api/mtf-portfolio', async (c) => {
  if (!c.env.SUPABASE_SERVICE_KEY) {
    return c.json({ success: true, count: 0, data: [] });
  }
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('mtf_active_portfolio')
      .select('*')
      .order('unrealized_pnl', { ascending: false });

    if (error) {
      console.error('[SUPABASE ERR] /api/mtf-portfolio:', error.message);
      return c.json({ success: true, count: 0, data: [], warning: error.message });
    }
    return c.json({ success: true, count: data?.length || 0, data: data || [] });
  } catch (err: any) {
    console.error('[EXCP ERR] /api/mtf-portfolio:', err?.message);
    return c.json({ success: true, count: 0, data: [], warning: err?.message || 'Unknown error' });
  }
});

// =====================
// UPSTOX LIVE PORTFOLIO & ORDERS
// =====================

/** GET /api/portfolio/funds — Calls Upstox funds & margin */
api.get('/api/portfolio/funds', async (c) => {
  try {
    const accessToken = await getUpstoxAccessToken(c);
    if (!accessToken) {
      return c.json({ success: false, error: 'Upstox token not found. Please re-authenticate.', isAuthError: true }, 200);
    }
    const fundsData = await getRawFunds(accessToken);
    return c.json({
      success: true,
      data: fundsData,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to fetch Upstox funds', isAuthError: true, data: null }, 200);
  }
});

/** GET /api/portfolio/positions — Fetches short-term/intraday positions */
api.get('/api/portfolio/positions', async (c) => {
  try {
    const accessToken = await getUpstoxAccessToken(c);
    if (!accessToken) {
      return c.json({ success: false, error: 'Upstox token not found. Please re-authenticate.', isAuthError: true, count: 0, data: [] }, 200);
    }
    const positions = await getPositions(accessToken);
    return c.json({
      success: true,
      count: positions?.length || 0,
      data: positions || [],
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to fetch positions', isAuthError: true, count: 0, data: [] }, 200);
  }
});

/** GET /api/portfolio/holdings — Fetches long-term delivery holdings */
api.get('/api/portfolio/holdings', async (c) => {
  try {
    const accessToken = await getUpstoxAccessToken(c);
    if (!accessToken) {
      return c.json({ success: false, error: 'Upstox token not found. Please re-authenticate.', isAuthError: true, count: 0, data: [] }, 200);
    }
    const holdings = await getHoldings(accessToken);
    return c.json({
      success: true,
      count: holdings?.length || 0,
      data: holdings || [],
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to fetch holdings', isAuthError: true, count: 0, data: [] }, 200);
  }
});

/** GET /api/upstox/order-book — Fetches today's trade order book */
api.get('/api/upstox/order-book', async (c) => {
  try {
    const accessToken = await getUpstoxAccessToken(c);
    if (!accessToken) {
      return c.json({ success: false, error: 'Upstox token not found. Please re-authenticate.', isAuthError: true, count: 0, data: [] }, 200);
    }
    const orders = await getOrderBook(accessToken);
    return c.json({
      success: true,
      count: orders?.length || 0,
      data: orders || [],
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to fetch order book', isAuthError: true, count: 0, data: [] }, 200);
  }
});

/** GET /api/screener/history — Past screener suggestions history */
api.get('/api/screener/history', async (c) => {
  try {
    if (c.env.SUPABASE_SERVICE_KEY) {
      const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
      
      const { data } = await supabase
        .from('mtf_screened_stocks')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);

      return c.json({
        success: true,
        count: data?.length || 0,
        data: data || [],
        timestamp: new Date().toISOString()
      });
    }

    return c.json({ success: true, count: 0, data: [] });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, data: [] }, 200);
  }
});

// =====================
// UTILITIES & BRIEFING
// =====================

/** GET /api/morning-briefing — Morning briefing */
api.get('/api/morning-briefing', async (c) => {
  if (!c.env.SUPABASE_SERVICE_KEY) {
    return c.json({ success: true, content: null, message: "SUPABASE_SERVICE_KEY secret missing" });
  }
  try {
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('system_events')
      .select('message, details, created_at')
      .eq('event_type', 'MORNING_BRIEFING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[SUPABASE ERR] /api/morning-briefing:', error.message);
      return c.json({ success: true, content: null, warning: error.message });
    }
    
    c.header('Cache-Control', 'public, max-age=900, stale-while-revalidate=86400');

    if (!data) {
      return c.json({ success: true, content: null });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const briefingDate = data.details?.briefing_date || '';

    return c.json({
      success: true,
      content: data.message,
      generatedAt: data.details?.timestamp || data.created_at,
      briefingDate: briefingDate,
      isToday: briefingDate === todayStr
    });
  } catch (err: any) {
    console.error('[EXCP ERR] /api/morning-briefing:', err?.message);
    return c.json({ success: true, content: null, warning: err?.message || 'Unknown error' });
  }
});

/** GET /api/trigger-cron — Manually trigger cron (DEBUG) */
api.get('/api/trigger-cron', async (c) => {
  try {
    await handleScheduled(c.env);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

/** GET /api/debug-time — Market time debug */
api.get('/api/debug-time', (c) => {
  return c.json({
    now: Date.now(),
    ist: getCurrentIST().toISOString(),
    components: getISTComponents(),
    isOpen: isMarketOpen(),
  });
});

export default api;
