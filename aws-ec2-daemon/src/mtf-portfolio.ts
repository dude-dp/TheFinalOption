// aws-ec2-daemon/src/mtf-portfolio.ts
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './logger.js';
import { calculateATR } from './lib/atr.js';
import { fetchWithRetry } from './lib/upstox-fetcher.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export interface PortfolioPosition {
  tradingsymbol: string;
  quantity: number;
  average_price: number;
  current_price: number;
  instrument_token?: string;
}

// Fetch active token from tokens table
async function getActiveUpstoxToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try {
    const { data } = await supabase
      .from('tokens')
      .select('access_token')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data?.access_token;
  } catch {
    return undefined;
  }
}

// Upstox API Wrapper for Holdings & Positions
async function fetchUpstoxPositionsAndHoldings(): Promise<PortfolioPosition[]> {
  const accessToken = await getActiveUpstoxToken();
  const positions: PortfolioPosition[] = [];

  if (accessToken) {
    const headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };

    try {
      // 1. Fetch Positions
      const posRes = await fetchWithRetry('https://api.upstox.com/v2/portfolio/short-term-positions', headers);
      if (posRes?.status === 'success' && Array.isArray(posRes.data)) {
        for (const item of posRes.data) {
          const qty = Number(item.quantity || 0);
          if (qty !== 0) {
            positions.push({
              tradingsymbol: item.tradingsymbol,
              quantity: Math.abs(qty),
              average_price: Number(item.average_price || item.buy_price || 0),
              current_price: Number(item.last_price || item.close_price || 0),
              instrument_token: item.instrument_token
            });
          }
        }
      }

      // 2. Fetch Holdings
      const holdRes = await fetchWithRetry('https://api.upstox.com/v2/portfolio/long-term-holdings', headers);
      if (holdRes?.status === 'success' && Array.isArray(holdRes.data)) {
        for (const item of holdRes.data) {
          const qty = Number(item.quantity || 0);
          if (qty > 0 && !positions.some(p => p.tradingsymbol === item.tradingsymbol)) {
            positions.push({
              tradingsymbol: item.tradingsymbol,
              quantity: qty,
              average_price: Number(item.average_price || 0),
              current_price: Number(item.last_price || item.close_price || 0),
              instrument_token: item.instrument_token
            });
          }
        }
      }
    } catch (err: any) {
      logWarn(`[PORTFOLIO] Upstox API fetch warning: ${err.message}. Falling back to active portfolio table.`);
    }
  }


  return positions;
}

// Fetch Daily Candles for ATR calculation
async function fetchDailyCandles(token: string, accessToken?: string): Promise<any[]> {
  if (!token) return [];
  const encoded = encodeURIComponent(token);
  const today = new Date().toISOString().split('T')[0];
  const past = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/day/${today}/${past}`;
  const json = await fetchWithRetry(url, headers);

  if (json?.status === 'success' && json?.data?.candles?.length > 0) {
    return json.data.candles.map((c: any) => ({
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4])
    })).reverse(); // oldest -> newest
  }

  return [];
}

export async function syncActivePortfolio() {
  if (!supabase) return;
  try {
    logInfo('[PORTFOLIO] 🔄 Synchronizing live MTF holdings from Upstox...');
    const holdings = await fetchUpstoxPositionsAndHoldings();
    const accessToken = await getActiveUpstoxToken();
    const portfolioPayload = [];

    for (const position of holdings) {
      if (position.quantity === 0) continue;

      // 1. Calculate PnL
      const investment = position.average_price * position.quantity;
      const currentValue = position.current_price * position.quantity;
      const pnl = currentValue - investment;
      const pnlPercent = investment > 0 ? (pnl / investment) * 100 : 0;

      // 2. Fetch Daily ATR to calculate Dynamic Trailing Stop-Loss
      let currentAtr = position.current_price * 0.015; // 1.5% ATR default fallback
      let trailingSl = position.average_price * 0.95; // 5% fallback SL

      if (position.instrument_token) {
        const candles = await fetchDailyCandles(position.instrument_token, accessToken);
        if (candles && candles.length >= 5) {
          const atrArray = calculateATR(candles, Math.min(14, candles.length - 1));
          if (atrArray && atrArray.length > 0) {
            const lastAtr = atrArray[atrArray.length - 1];
            if (lastAtr > 0) {
              currentAtr = lastAtr;
              // Trailing SL: Current Price minus 2x Daily ATR
              trailingSl = position.current_price - (currentAtr * 2);
              // Never let Trailing SL drop below initial 2x ATR stop
              const initialSl = position.average_price - (currentAtr * 2);
              trailingSl = Math.max(trailingSl, initialSl);
            }
          }
        }
      }

      // 3. Days Held calculation
      const daysHeld = 3;

      portfolioPayload.push({
        tradingsymbol: position.tradingsymbol,
        quantity: position.quantity,
        average_price: Number(position.average_price.toFixed(2)),
        current_price: Number(position.current_price.toFixed(2)),
        unrealized_pnl: Number(pnl.toFixed(2)),
        pnl_percent: Number(pnlPercent.toFixed(2)),
        days_held: daysHeld,
        current_atr: Number(currentAtr.toFixed(2)),
        trailing_sl: Number(trailingSl.toFixed(2)),
        updated_at: new Date().toISOString()
      });
    }

    // Fetch current symbols in the database to identify closed positions
    const { data: currentRows } = await supabase.from('mtf_active_portfolio').select('tradingsymbol');
    const currentSymbols = new Set(currentRows?.map(r => r.tradingsymbol) || []);

    if (portfolioPayload.length > 0) {
      await supabase.from('mtf_active_portfolio').upsert(portfolioPayload, { onConflict: 'tradingsymbol' });
    }

    // Delete symbols no longer in portfolio
    const activeSymbols = new Set(portfolioPayload.map(p => p.tradingsymbol));
    const symbolsToDelete = [...currentSymbols].filter(sym => !activeSymbols.has(sym));
    
    if (symbolsToDelete.length > 0) {
      await supabase.from('mtf_active_portfolio').delete().in('tradingsymbol', symbolsToDelete);
    }

    logInfo(`[PORTFOLIO] ✅ Synced ${portfolioPayload.length} active positions. Removed ${symbolsToDelete.length} closed positions.`);

  } catch (error: any) {
    logError(`[PORTFOLIO] ❌ Sync failed: ${error.message}`);
  }
}

// --- SECURE MARKET HOURS CRON ---
export function startPortfolioPoller() {
  // Initial sync at startup
  syncActivePortfolio().catch(err => logError(`[PORTFOLIO] Startup sync error: ${err.message}`));

  // Run every 5 minutes from Monday to Friday
  cron.schedule('*/5 * * * 1-5', () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hours = istTime.getHours();
    const mins = istTime.getMinutes();

    // STRICT MARKET HOURS CHECK: 09:15 AM to 03:30 PM IST
    const isMarketOpen = (hours === 9 && mins >= 15) || (hours > 9 && hours < 15) || (hours === 15 && mins <= 30);

    if (isMarketOpen) {
      syncActivePortfolio();
    }
  }, {
    timezone: "Asia/Kolkata"
  });
  
  logInfo('[PORTFOLIO] 🕒 Secure Market-Hours Poller initialized (9:15-15:30 IST).');
}
