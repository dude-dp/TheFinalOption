import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './logger.js';
import { calculateMACD } from './lib/macd.js';
import { calculateRSI } from './lib/rsi.js';
import { calculateADX, Candle } from './lib/adx.js';
import { calculateATR, calculateSuggestedSL } from './lib/atr.js';
import { calculateVWAPDistance } from './lib/vwap.js';
import { calculateRVOL } from './lib/rvol.js';
import { syncUpstoxInstrumentMaster } from './lib/instrument-sync.js';
import { sendMTFAlert } from './lib/notify.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export interface MTFWatchlistItem {
  token: string;
  symbol: string;
  sector: string;
  margin: number;
}

// Fallback high-liquidity stocks if DB is unreachable
export const DEFAULT_MTF_WATCHLIST: MTFWatchlistItem[] = [
  { token: 'NSE_EQ|INE002A01018', symbol: 'RELIANCE', sector: 'OIL & GAS', margin: 4.0 },
  { token: 'NSE_EQ|INE467B01029', symbol: 'TCS', sector: 'IT', margin: 3.5 },
  { token: 'NSE_EQ|INE009A01021', symbol: 'INFY', sector: 'IT', margin: 3.5 },
  { token: 'NSE_EQ|INE040A01034', symbol: 'HDFCBANK', sector: 'BANKS', margin: 4.0 },
  { token: 'NSE_EQ|INE090A01021', symbol: 'ICICIBANK', sector: 'BANKS', margin: 4.0 },
  { token: 'NSE_EQ|INE238A01034', symbol: 'AXISBANK', sector: 'BANKS', margin: 3.5 },
  { token: 'NSE_EQ|INE062A01020', symbol: 'SBIN', sector: 'BANKS', margin: 4.0 },
  { token: 'NSE_EQ|INE155A01022', symbol: 'TATAMOTORS', sector: 'AUTO', margin: 3.5 },
  { token: 'NSE_EQ|INE018A01030', symbol: 'LTIM', sector: 'IT', margin: 3.0 },
  { token: 'NSE_EQ|INE075A01022', symbol: 'WIPRO', sector: 'IT', margin: 3.5 },
  { token: 'NSE_EQ|INE081A01012', symbol: 'TATASTEEL', sector: 'METAL', margin: 3.5 },
  { token: 'NSE_EQ|INE044A01036', symbol: 'SUNPHARMA', sector: 'PHARMA', margin: 3.5 },
  { token: 'NSE_EQ|INE216A01030', symbol: 'INDUSINDBK', sector: 'BANKS', margin: 3.0 },
  { token: 'NSE_EQ|INE101A01026', symbol: 'M&M', sector: 'AUTO', margin: 3.5 },
  { token: 'NSE_EQ|INE585A01010', symbol: 'MARUTI', sector: 'AUTO', margin: 4.0 },
  { token: 'NSE_EQ|INE296A01024', symbol: 'BAJAJFINSV', sector: 'FINANCE', margin: 3.5 },
  { token: 'NSE_EQ|INE237A01028', symbol: 'KOTAKBANK', sector: 'BANKS', margin: 3.5 },
  { token: 'NSE_EQ|INE397D01024', symbol: 'BHARTIARTL', sector: 'TELECOM', margin: 4.0 }
];

/**
 * Fetch 15-minute historical candles from Upstox API
 */
async function fetchUpstox15mCandles(token: string, upstoxAccessToken?: string): Promise<Candle[]> {
  try {
    const encodedKey = encodeURIComponent(token);
    const todayStr = new Date().toISOString().split('T')[0];
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const pastStr = pastDate.toISOString().split('T')[0];

    const url = `https://api.upstox.com/v2/historical-candle/${encodedKey}/15minute/${todayStr}/${pastStr}`;
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (upstoxAccessToken) {
      headers['Authorization'] = `Bearer ${upstoxAccessToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const fallbackUrl = `https://api.upstox.com/v2/historical-candle/intraday/${encodedKey}/15minute`;
      const fallbackRes = await fetch(fallbackUrl, { headers: { 'Accept': 'application/json' } });
      if (!fallbackRes.ok) return [];
      const json = await fallbackRes.json();
      if (!json.data || !json.data.candles) return [];
      return parseUpstoxCandles(json.data.candles);
    }

    const json = await res.json();
    if (!json.data || !json.data.candles) return [];
    return parseUpstoxCandles(json.data.candles);
  } catch (err: any) {
    logError(`[MTF-SCREENER] Upstox fetch error for ${token}: ${err.message}`);
    return [];
  }
}

function parseUpstoxCandles(rawCandles: any[]): Candle[] {
  // Upstox candle format: [timestamp, open, high, low, close, volume, open_interest]
  // Returned newest first, so we reverse to oldest first
  const parsed: Candle[] = rawCandles.map(c => ({
    timestamp: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  }));
  return parsed.reverse();
}

/**
 * Get active Upstox access token from Supabase system_state table
 */
async function getActiveUpstoxToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try {
    const { data } = await supabase.from('system_state').select('upstox_access_token').eq('id', 1).single();
    return data?.upstox_access_token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run 15-Minute Quantitative Screener
 */
export async function run15MinScreener() {
  logInfo('[MTF-SCREENER] ⚡ Initiating 15-minute quantitative MTF scan...');
  
  if (!supabase) {
    logWarn('[MTF-SCREENER] 🚨 Supabase not connected. Skipping DB save.');
    return;
  }

  const token = await getActiveUpstoxToken();

  // 1. Get High-Liquidity Watchlist from Supabase mtf_instrument_master
  let watchlist: { token: string; symbol: string; sector: string; margin: number }[] = [];
  try {
    const { data } = await supabase
      .from('mtf_instrument_master')
      .select('instrument_token, tradingsymbol, sector')
      .eq('liquidity_tier', 'HIGH')
      .eq('is_active', true);

    if (data && data.length > 0) {
      watchlist = data.map(item => ({
        token: item.instrument_token,
        symbol: item.tradingsymbol,
        sector: item.sector || 'EQUITY',
        margin: 3.5
      }));
    } else {
      // Run automatic initial sync if instrument master is empty!
      logInfo('[MTF-SCREENER] Instrument Master empty. Running automatic Upstox sync...');
      await syncUpstoxInstrumentMaster();
      const retry = await supabase
        .from('mtf_instrument_master')
        .select('instrument_token, tradingsymbol, sector')
        .eq('liquidity_tier', 'HIGH')
        .eq('is_active', true);

      if (retry.data && retry.data.length > 0) {
        watchlist = retry.data.map(item => ({
          token: item.instrument_token,
          symbol: item.tradingsymbol,
          sector: item.sector || 'EQUITY',
          margin: 3.5
        }));
      }
    }
  } catch (err: any) {
    logError(`[MTF-SCREENER] Watchlist query failed: ${err.message}. Using fallback watchlist.`);
  }

  if (watchlist.length === 0) {
    watchlist = DEFAULT_MTF_WATCHLIST;
  }

  logInfo(`[MTF-SCREENER] Screening ${watchlist.length} liquid equities...`);
  const matchingStocks: any[] = [];

  // Chunking in batches of 10 with 1s cooldown to respect Upstox API rate limits
  const chunkSize = 10;
  for (let i = 0; i < watchlist.length; i += chunkSize) {
    const chunk = watchlist.slice(i, i + chunkSize);
    
    await Promise.all(chunk.map(async (stock) => {
      try {
        const candles = await fetchUpstox15mCandles(stock.token, token);
        if (candles.length < 35) return;

        const closes = candles.map(c => c.close);

        // Indicators
        const { macdLine } = calculateMACD(closes);
        if (macdLine.length < 2) return;

        const currentMacd = macdLine[macdLine.length - 1];
        const prevMacd = macdLine[macdLine.length - 2];
        
        const rsiSeries = calculateRSI(closes, 14);
        const currentRsi = rsiSeries[rsiSeries.length - 1];

        const adxSeries = calculateADX(candles, 14);
        const currentAdx = adxSeries[adxSeries.length - 1];

        const atrSeries = calculateATR(candles, 14);
        const currentAtr = atrSeries[atrSeries.length - 1];

        const currentPrice = closes[closes.length - 1];
        const vwapDistance = calculateVWAPDistance(candles);
        const currentRvol = calculateRVOL(candles);
        const suggestedSL = calculateSuggestedSL(currentPrice, currentAtr, 2.0);

        // Signals & Alpha Filters
        const isZeroLineCross = prevMacd <= 0 && currentMacd > 0;
        const isBullish = currentMacd > 0 && currentRsi > 55;

        // Institutional Filter: Must have active RVOL participation (>=1.0) and not overextended (<3.5%)
        const isValidSetup = (isZeroLineCross || isBullish) && 
                             currentRvol >= 1.0 && 
                             vwapDistance < 3.5;

        if (isValidSetup) {
          const setupData = {
            instrument_token: stock.token,
            tradingsymbol: stock.symbol,
            sector: stock.sector,
            current_price: Number(currentPrice.toFixed(2)),
            mtf_margin_multiplier: stock.margin,
            distance_from_vwap_pct: Number(vwapDistance.toFixed(2)),
            rsi_14: Number(currentRsi.toFixed(2)),
            macd_value: Number(currentMacd.toFixed(2)),
            macd_signal: isZeroLineCross ? 'ZERO_LINE_CROSS' : 'BULLISH_MOMENTUM',
            adx_trend: Number(currentAdx.toFixed(2)),
            rvol: Number(currentRvol.toFixed(2)),
            atr_value: Number(currentAtr.toFixed(2)),
            suggested_sl: suggestedSL,
            updated_at: new Date().toISOString()
          };

          matchingStocks.push(setupData);

          // 🎯 DISCORD SNIPER NOTIFICATION TRIGGER:
          // Alert Discord if setup is top-tier: RVOL >= 1.8 and safely near VWAP (-1.0% <= VWAP <= 2.0%)
          if (currentRvol >= 1.8 && vwapDistance <= 2.0 && vwapDistance >= -1.0) {
            sendMTFAlert(setupData).catch(err => logError(`[NOTIFY] Alert error for ${stock.symbol}: ${err.message}`));
          }
        }
      } catch (err: any) {
        logError(`[MTF-SCREENER] Error screening ${stock.symbol}: ${err.message}`);
      }
    }));

    // Rate-limit cooldown delay between chunks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (matchingStocks.length > 0) {
    const { error } = await supabase.from('mtf_screened_stocks').upsert(matchingStocks);
    if (error) {
      logError(`[MTF-SCREENER] DB Upsert error: ${error.message}`);
    } else {
      logInfo(`[MTF-SCREENER] ✅ Successfully screened & cached ${matchingStocks.length} MTF setups.`);
    }
  } else {
    logInfo('[MTF-SCREENER] Scan complete. No active 15m MACD setups detected.');
  }

  // Update system_controls timestamp so UI knows scan is finalized
  try {
    await supabase.from('system_controls').update({ last_scan_time: new Date().toISOString() }).eq('id', 1);
  } catch (err: any) {
    logError(`[MTF-SCREENER] Failed to update last_scan_time in system_controls: ${err.message}`);
  }
}

/**
 * -------------------------------------------------------------
 * THE TRIGGER LISTENER: Polls Supabase for on-demand scan requests
 * -------------------------------------------------------------
 */
export function startMTFTriggerListener() {
  logInfo('[MTF-SCREENER] Starting Supabase On-Demand Trigger Listener (polling every 3s)...');
  setInterval(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.from('system_controls').select('mtf_scan_requested').eq('id', 1).single();
      
      if (data && data.mtf_scan_requested) {
        logInfo('[MTF-SCREENER] ⚡ On-Demand MTF scan requested from UI! Executing immediately...');
        // Acknowledge request immediately to prevent duplicate runs
        await supabase.from('system_controls').update({ mtf_scan_requested: false }).eq('id', 1);
        
        // Execute scan
        await run15MinScreener();
      }
    } catch (err: any) {
      logError(`[MTF-SCREENER] Trigger listener check failed: ${err.message}`);
    }
  }, 3000);
}
