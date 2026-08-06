// ============================================
// Upstox API v3 Client
// Market data, options, funds, positions
// ============================================

import type { UpstoxFundsResponse } from './types';

const BASE_URL = 'https://api.upstox.com';
const HFT_URL = 'https://api-hft.upstox.com';

// --- Helper ---

async function upstoxGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upstox GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function upstoxPost(path: string, token: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// --- Funds & Margin ---

export async function getFundsAndMargin(token: string): Promise<UpstoxFundsResponse> {
  const data = await upstoxGet('/v3/user/get-funds-and-margin', token);
  const funds = data?.data;

  const v3Available = funds?.available_to_trade?.total || funds?.available_to_trade?.cash_available_to_trade?.total;
  const v3Used = funds?.available_to_trade?.cash_available_to_trade?.margin_used?.total;
  const v3Total = v3Available; // In V3, total available represents the total equity balance

  return {
    availableMargin: v3Available ?? funds?.equity?.available_margin ?? funds?.available_margin ?? 0,
    usedMargin: v3Used ?? funds?.equity?.used_margin ?? funds?.used_margin ?? 0,
    totalBalance: v3Total ?? funds?.equity?.total_balance ?? funds?.total_balance ?? 0,
  };
}

// --- LTP Quotes ---

export async function getLTP(
  token: string,
  instrumentKeys: string[]
): Promise<Record<string, number>> {
  const keys = instrumentKeys.map(encodeURIComponent).join(',');
  const path = `/v3/market-quote/ltp?instrument_key=${keys}`;
  const data = await upstoxGet(path, token);

  const ltpMap: Record<string, number> = {};
  if (data?.data) {
    for (const [key, val] of Object.entries(data.data) as any) {
      ltpMap[key] = val.last_price || 0;
    }
  }
  return ltpMap;
}

export async function getRawFunds(token: string): Promise<any> {
  const data = await upstoxGet('/v2/user/get-funds-and-margin', token);
  return data?.data || null;
}

// --- Positions ---

export async function getPositions(token: string): Promise<any[]> {
  const data = await upstoxGet('/v2/portfolio/short-term-positions', token);
  return data?.data || [];
}

// --- Holdings ---

export async function getHoldings(token: string): Promise<any[]> {
  const data = await upstoxGet('/v2/portfolio/long-term-holdings', token);
  return data?.data || [];
}

// --- Order Book ---

export async function getOrderBook(token: string): Promise<any[]> {
  const data = await upstoxGet('/v2/order/retrieve-all', token);
  return data?.data || [];
}

// --- Order Placement (used by LOCAL DAEMON, not cloud worker) ---

export async function placeOrder(token: string, params: {
  instrumentToken: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  product: string;
  orderType: string;
  price: number;
  triggerPrice?: number;
  tag?: string;
}): Promise<{ orderId: string; status: string; message: string }> {
  const body = {
    instrument_token: params.instrumentToken,
    transaction_type: params.transactionType,
    quantity: params.quantity,
    product: params.product || 'I', // Intraday
    validity: 'DAY',
    order_type: params.orderType || 'MARKET',
    price: params.price || 0,
    trigger_price: params.triggerPrice || 0,
    disclosed_quantity: 0,
    is_amo: false,
    slice: true, // Auto-slice for large orders
    tag: params.tag || '',
  };

  const data = await upstoxPost('/v2/order/place', token, body);

  return {
    orderId: data?.data?.order_id || '',
    status: data?.status || 'unknown',
    message: data?.message || '',
  };
}

// --- Order Status ---

export async function getOrderStatus(
  token: string,
  orderId: string
): Promise<any> {
  const data = await upstoxGet(`/v2/order/details?order_id=${orderId}`, token);
  return data?.data || null;
}

// --- OAuth Helpers ---

export function getAuthorizationUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
  });
  return `https://api.upstox.com/v2/login/authorization/dialog?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch('https://api.upstox.com/v2/login/authorization/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${await res.text()}`);
  }

  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 86400,
  };
}

// ============================================
// MTF Screener Candle Fetcher
// Fetches historical candles for any instrument
// Used by the Queue Consumer worker
// ============================================

/**
 * Fetch historical candles for a given instrument token.
 * Supports '30minute' and 'day' intervals.
 * Returns candles in oldest-first order.
 *
 * @param accessToken  Upstox Bearer token
 * @param instrumentKey  e.g. "NSE_EQ|INE002A01018"
 * @param interval  '30minute' | 'day'
 * @param daysBack  Number of calendar days of history to fetch
 */
export async function fetchScreenerCandles(
  accessToken: string,
  instrumentKey: string,
  interval: '30minute' | 'day',
  daysBack: number = 5
): Promise<import('./types').Candle[]> {
  const encoded  = encodeURIComponent(instrumentKey);
  const today    = new Date().toISOString().split('T')[0];
  const past     = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  const url      = `${BASE_URL}/v2/historical-candle/${encoded}/${interval}/${today}/${past}`;

  const headers: Record<string, string> = {
    'Accept':        'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  // --- Fetch with 3 retries + 429 back-off ---
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        const wait = 3000 * attempt + Math.floor(Math.random() * 1000);
        console.warn(`[UPSTOX] 429 on ${instrumentKey} — backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        console.warn(`[UPSTOX] HTTP ${res.status} for ${instrumentKey} (attempt ${attempt})`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        return [];
      }

      const json: any = await res.json();
      if (json?.status !== 'success' || !json?.data?.candles?.length) return [];

      return (json.data.candles as any[][]).map(c => ({
        timestamp: c[0] as string,
        open:      Number(c[1]),
        high:      Number(c[2]),
        low:       Number(c[3]),
        close:     Number(c[4]),
        volume:    Number(c[5])
      })).reverse(); // oldest → newest

    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        console.warn(`[UPSTOX] Timeout for ${instrumentKey} (attempt ${attempt})`);
      } else {
        console.error(`[UPSTOX] Network error for ${instrumentKey}: ${err.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  return [];
}
