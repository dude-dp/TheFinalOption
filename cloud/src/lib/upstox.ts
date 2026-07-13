// ============================================
// Upstox API v3 Client
// Market data, options, funds, positions
// ============================================

import type { UpstoxCandle, UpstoxOptionChainEntry, UpstoxFundsResponse } from './types';

const BASE_URL = 'https://api.upstox.com';
const HFT_URL = 'https://api-hft.upstox.com';
const NIFTY_INDEX_KEY = 'NSE_INDEX|Nifty 50';

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

// --- Historical Candles ---

/**
 * Fetch 1-minute historical candles for NIFTY 50 Index.
 * Returns candles oldest-first for MACD calculation.
 */
export async function fetchNiftyCandles(
  token: string,
  toDate: string // YYYY-MM-DD
): Promise<UpstoxCandle[]> {
  const encodedKey = encodeURIComponent(NIFTY_INDEX_KEY);
  const path = `/v2/historical-candle/intraday/${encodedKey}/1minute`;
  const data = await upstoxGet(path, token);

  if (!data?.data?.candles) return [];

  // Upstox returns [timestamp, O, H, L, C, V, OI] arrays, newest first
  const raw: any[][] = data.data.candles;
  const candles: UpstoxCandle[] = raw.reverse().map((c: any[]) => ({
    timestamp: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
    oi: c[6] || 0,
  }));

  return candles;
}

// --- Option Chain ---

/**https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX%7CNifty%2050/1minute
 * Fetch the option chain for NIFTY at a given expiry.
 * Returns entries filtered to relevant strikes.
 */
export async function getOptionChain(
  token: string,
  expiryDate: string,
  kv?: KVNamespace
): Promise<UpstoxOptionChainEntry[]> {
  const cacheKey = `option_chain_${expiryDate}`;
  if (kv) {
    const cached = await kv.get(cacheKey, 'json');
    if (cached) return cached as UpstoxOptionChainEntry[];
  }

  const encodedKey = encodeURIComponent(NIFTY_INDEX_KEY);
  const path = `/v2/option/chain?instrument_key=${encodedKey}&expiry_date=${expiryDate}`;
  const data = await upstoxGet(path, token);

  if (!data?.data) return [];

  const entries: UpstoxOptionChainEntry[] = [];

  for (const item of data.data) {
    // Each item has call_options and put_options
    if (item.call_options?.market_data) {
      entries.push({
        instrumentKey: item.call_options.instrument_key,
        strikePrice: item.strike_price,
        expiryDate: item.expiry,
        optionType: 'CE',
        ltp: item.call_options.market_data.ltp || 0,
        tradingSymbol: item.call_options.trading_symbol || '',
        lotSize: item.call_options.lot_size || 65,
        openInterest: item.call_options.market_data.oi || 0,
        theta: item.call_options.option_greeks?.theta || 0,
      });
    }
    if (item.put_options?.market_data) {
      entries.push({
        instrumentKey: item.put_options.instrument_key,
        strikePrice: item.strike_price,
        expiryDate: item.expiry,
        optionType: 'PE',
        ltp: item.put_options.market_data.ltp || 0,
        tradingSymbol: item.put_options.trading_symbol || '',
        lotSize: item.put_options.lot_size || 65,
        openInterest: item.put_options.market_data.oi || 0,
        theta: item.put_options.option_greeks?.theta || 0,
      });
    }
  }

  if (kv && entries.length > 0) {
    await kv.put(cacheKey, JSON.stringify(entries), { expirationTtl: 25200 });
  }

  return entries;
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

// --- Positions ---

export async function getPositions(token: string): Promise<any[]> {
  const data = await upstoxGet('/v2/portfolio/short-term-positions', token);
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
// Notifications
// ============================================
export async function notifyDiscord(webhookUrl: string | undefined, message: string): Promise<void> {
  if (!webhookUrl) return; // Fail silently if not configured
  
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "TheFinalOption Bot",
        // Optional: Adds a flame icon to the bot's avatar
        avatar_url: "https://raw.githubusercontent.com/tabler/icons/master/icons/flame.svg",
        content: message
      }),
    });
  } catch (error) {
    console.error('Discord webhook failed:', error);
  }
}

/**
 * Fetches historical 1-minute candles for a specific date range.
 * Dates must be in YYYY-MM-DD format.
 */
export async function fetchHistoricalCandlesRange(accessToken: string, fromDate: string, toDate: string): Promise<any[]> {
  const instrumentKey = encodeURIComponent('NSE_INDEX|Nifty 50');
  // Upstox URL format: /v2/historical-candle/{instrumentKey}/{interval}/{to_date}/{from_date}
  const url = `https://api.upstox.com/v2/historical-candle/${instrumentKey}/1minute/${toDate}/${fromDate}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upstox API Error: ${response.status} - ${errorText}`);
  }

  const data: any = await response.json();
  if (data.status !== 'success' || !data.data || !data.data.candles) {
    return [];
  }

  // Upstox historical format is an array of arrays: [timestamp, open, high, low, close, volume, oi]
  // We need to map it to our standard object and convert the timestamp to a standard ISO string.
  return data.data.candles.map((c: any[]) => ({
    timestamp: new Date(c[0]).toISOString(),
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] || 0
  })).reverse(); // Upstox returns newest first; reverse to chronological ASC
}
