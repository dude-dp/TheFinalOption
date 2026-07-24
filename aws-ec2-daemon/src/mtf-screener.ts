import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './logger.js';
import { calculateMACD, calculateEMA } from './lib/macd.js';
import { calculateRSI } from './lib/rsi.js';
import { calculateADX, Candle } from './lib/adx.js';
import { calculateATR, calculateSuggestedSL } from './lib/atr.js';
import { calculateVWAPDistance } from './lib/vwap.js';
import { calculateRVOL } from './lib/rvol.js';
import { syncUpstoxInstrumentMaster } from './lib/instrument-sync.js';
import { sendMTFAlert } from './lib/notify.js';
import { fetchWithRetry, sleep } from './lib/upstox-fetcher.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ============================================================
// UPSTOX CANDLE FETCHER — uses bulletproof retry lib
// ============================================================

function parseUpstoxCandles(rawCandles: any[]): Candle[] {
  const parsed: Candle[] = rawCandles.map(c => ({
    timestamp: c[0],
    open:   Number(c[1]),
    high:   Number(c[2]),
    low:    Number(c[3]),
    close:  Number(c[4]),
    volume: Number(c[5])
  }));
  return parsed.reverse(); // oldest → newest
}

async function fetchCandles(
  token: string,
  interval: '30minute' | 'day',
  daysBack: number,
  accessToken?: string
): Promise<Candle[]> {
  const encoded = encodeURIComponent(token);
  const today = new Date().toISOString().split('T')[0];
  const past  = new Date(Date.now() - daysBack * 86400_000).toISOString().split('T')[0];

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/${interval}/${today}/${past}`;
  const json = await fetchWithRetry(url, headers);

  if (json?.status === 'success' && json?.data?.candles?.length > 0) {
    return parseUpstoxCandles(json.data.candles);
  }

  return [];
}

// ============================================================
// TOKEN RESOLVER
// ============================================================
async function getActiveUpstoxToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try {
    const { data } = await supabase
      .from('system_state').select('upstox_access_token').eq('id', 1).single();
    return data?.upstox_access_token || undefined;
  } catch { return undefined; }
}

// ============================================================
// MULTI-SIGNAL DETECTOR (15m)
// ============================================================
function detect15mSignals(candles: Candle[]): {
  signals: string[];
  macdValue: number;
  rsi: number;
  adx: number;
  atr: number;
  vwapDist: number;
  rvol: number;
  suggestedSL: number;
  price: number;
} | null {
  const closes = candles.map(c => c.close);
  if (closes.length < 35) return null;

  const { macdLine, histogram } = calculateMACD(closes);
  if (macdLine.length < 3) return null;

  const currentMacd15m = macdLine[macdLine.length - 1];
  const prevMacd15m    = macdLine[macdLine.length - 2];
  const prev2Macd15m   = macdLine[macdLine.length - 3];
  const currentHist    = histogram[histogram.length - 1];

  const rsiSeries  = calculateRSI(closes, 14);
  const adxSeries  = calculateADX(candles, 14);
  const atrSeries  = calculateATR(candles, 14);
  const currentRsi = rsiSeries[rsiSeries.length - 1];
  const currentAdx = adxSeries[adxSeries.length - 1];
  const currentAtr = atrSeries[atrSeries.length - 1];
  const price      = closes[closes.length - 1];
  const vwapDist   = calculateVWAPDistance(candles);
  const rvol       = calculateRVOL(candles);
  const suggestedSL = calculateSuggestedSL(price, currentAtr, 2.0);

  const currCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // 1. Classic AutoBot Zero-Line Cross
  const isZeroLineCross15m = prevMacd15m <= 0 && currentMacd15m > 0;

  // 2. Anticipatory "Approaching Zero" Logic
  const isApproachingZero = currentMacd15m < 0 && 
                            currentMacd15m > prevMacd15m && 
                            prevMacd15m > prev2Macd15m &&
                            currentHist > 0 &&
                            (currentMacd15m - prevMacd15m) > 0.5;

  // 3. Candlestick Pattern Recognition
  const currOpen = currCandle.open ?? currCandle.close;
  const prevOpen = prevCandle.open ?? prevCandle.close;
  
  const isRedPrev = prevCandle.close < prevOpen;
  const isGreenCurr = currCandle.close > currOpen;

  const isBullishEngulfing = isRedPrev && isGreenCurr && 
                             currCandle.close > prevOpen && 
                             currOpen < prevCandle.close;

  const body = Math.abs(currCandle.close - currOpen);
  const lowerShadow = Math.min(currOpen, currCandle.close) - currCandle.low;
  const upperShadow = currCandle.high - Math.max(currOpen, currCandle.close);
  const isHammer = isGreenCurr && (lowerShadow >= 2 * body) && (upperShadow <= body * 0.5);

  const hasBullishPriceAction = isBullishEngulfing || isHammer;

  // --- THE GATEKEEPER ---
  if (!(isZeroLineCross15m || isApproachingZero || (hasBullishPriceAction && currentMacd15m > -0.5))) {
    return null;
  }

  const signals: string[] = [];
  
  if (isZeroLineCross15m) signals.push('ZERO_LINE_CROSS');
  else if (isApproachingZero) signals.push('APPROACHING_ZERO');
  else if (isBullishEngulfing) signals.push('BULLISH_ENGULFING');
  else if (isHammer) signals.push('HAMMER_REVERSAL');

  if (rsiSeries.length >= 3) {
    const r0 = rsiSeries[rsiSeries.length - 1], r1 = rsiSeries[rsiSeries.length - 2], r2 = rsiSeries[rsiSeries.length - 3];
    if (r2 < 35 && r1 <= r2 && r0 > r1) signals.push('RSI_REVERSAL');
    if (r1 < 50 && r0 >= 50) signals.push('RSI_50_CROSS');
  }

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  if (ema9.length >= 2 && ema21.length > (21 - 9) + 1) {
    const currE9 = ema9[ema9.length - 1], prevE9 = ema9[ema9.length - 2];
    const currE21 = ema21[ema21.length - 1], prevE21 = ema21[ema21.length - 2];
    if (prevE9 <= prevE21 && currE9 > currE21) signals.push('EMA_GOLDEN_CROSS');
  }

  return {
    signals,
    macdValue: currentMacd15m,
    rsi: currentRsi,
    adx: currentAdx,
    atr: currentAtr,
    vwapDist: vwapDist,
    rvol: rvol,
    suggestedSL,
    price
  };
}

// ============================================================
// 3H CONFIRMATION CHECK (called only after 15m passes gate)
// ============================================================
async function check3HConviction(token: string, accessToken?: string): Promise<boolean> {
  try {
    // Fetch 40 days of 3H candles (same as AutoBot — gives EMA enough warmup)
    const candles3h = await fetchCandles(token, 'day', 40, accessToken);
    if (candles3h.length < 20) return false;

    const closes3h = candles3h.map(c => c.close);
    const { macdLine } = calculateMACD(closes3h);
    if (macdLine.length < 2) return false;

    const curr3h = macdLine[macdLine.length - 1];
    const prev3h = macdLine[macdLine.length - 2];

    // 3H is bullish if MACD is already above zero, OR is crossing zero right now
    return curr3h > 0 || (prev3h < 0 && curr3h > 0);
  } catch {
    return false;
  }
}

// ============================================================
// CORE 6-WORKER CONCURRENT SCREENER
// ============================================================
export async function run15MinScreener() {
  logInfo('[MTF-SCREENER] Initiating Dual-Timeframe 6-Worker MTF Scan...');

  if (!supabase) {
    logWarn('[MTF-SCREENER] Supabase not connected. Skipping scan.');
    return;
  }

  const accessToken = await getActiveUpstoxToken();

  // --- 1. Load watchlist (HIGH liquidity = all Upstox MTF-approved stocks) ---
  let watchlist: { token: string; symbol: string; sector: string; margin: number }[] = [];

  try {
    const { data } = await supabase
      .from('mtf_instrument_master')
      .select('instrument_token, tradingsymbol, sector, mtf_bracket')
      .eq('liquidity_tier', 'HIGH')
      .eq('is_active', true);

    if (data && data.length > 0) {
      watchlist = data.map(item => ({
        token:  item.instrument_token,
        symbol: item.tradingsymbol,
        sector: item.sector || 'EQUITY',
        margin: Number(item.mtf_bracket) || 3.5
      }));
    } else {
      logInfo('[MTF-SCREENER] Instrument Master empty. Running automatic sync...');
      await syncUpstoxInstrumentMaster();
      const retry = await supabase
        .from('mtf_instrument_master')
        .select('instrument_token, tradingsymbol, sector, mtf_bracket')
        .eq('liquidity_tier', 'HIGH').eq('is_active', true);
      if (retry.data && retry.data.length > 0) {
        watchlist = retry.data.map(item => ({
          token:  item.instrument_token,
          symbol: item.tradingsymbol,
          sector: item.sector || 'EQUITY',
          margin: Number(item.mtf_bracket) || 3.5
        }));
      }
    }
  } catch (err: any) {
    logError(`[MTF-SCREENER] Watchlist query failed: ${err.message}`);
  }

  if (watchlist.length === 0) {
    logWarn('[MTF-SCREENER] Watchlist is empty — cannot scan.');
    return;
  }

  logInfo(`[MTF-SCREENER] Deploying 6 workers across ${watchlist.length} stocks...`);

  const matchingStocks: any[] = [];
  let currentIndex = 0;
  let totalScanned = 0;
  let totalSignals = 0;

  // --- 2. Worker function (AutoBot pattern) ---
  const worker = async (workerId: number) => {
    while (currentIndex < watchlist.length) {
      const stock = watchlist[currentIndex++]; // atomic grab

      try {
        // STEP A: Fetch 15-minute candles (5 days of data)
        const candles15m = await fetchCandles(stock.token, '30minute', 5, accessToken);
        totalScanned++;

        // Progress telemetry every 20 stocks from worker 0
        if (workerId === 0 && totalScanned % 20 === 0) {
          logInfo(`[MTF-SCREENER] [W0] Progress: ${totalScanned}/${watchlist.length}`);
        }

        // STEP B: Run 15m multi-signal detection (the "gate")
        const result = detect15mSignals(candles15m);
        if (!result) {
          await sleep(60); // 6 workers × 60ms = ~100 req/s, under Upstox 150 req/s limit
          continue;
        }

        // STEP C: 3H Conviction check — "lazy evaluation" (only fired if 15m passes)
        const is3HAligned = await check3HConviction(stock.token, accessToken);
        const conviction  = is3HAligned ? 'HIGH' : 'NORMAL';

        // STEP D: Pick primary signal label
        const SIGNAL_PRIORITY = [
          'ZERO_LINE_CROSS', 'SIGNAL_LINE_CROSS', 'APPROACHING_ZERO',
          'EMA_GOLDEN_CROSS', 'BULLISH_ENGULFING', 'HAMMER',
          'RSI_REVERSAL', 'RSI_50_CROSS', 'BULLISH_MOMENTUM'
        ];
        const primarySignal = SIGNAL_PRIORITY.find(s => result.signals.includes(s)) || result.signals[0];

        const setupData: any = {
          instrument_token:      stock.token,
          tradingsymbol:         stock.symbol,
          sector:                stock.sector,
          current_price:         Number(result.price.toFixed(2)),
          mtf_margin_multiplier: stock.margin,
          distance_from_vwap_pct: Number(result.vwapDist.toFixed(2)),
          rsi_14:                Number(result.rsi.toFixed(2)),
          macd_value:            Number(result.macdValue.toFixed(2)),
          macd_signal:           primarySignal,
          adx_trend:             Number(result.adx.toFixed(2)),
          rvol:                  Number(result.rvol.toFixed(2)),
          atr_value:             Number(result.atr.toFixed(2)),
          suggested_sl:          result.suggestedSL,
          conviction,
          updated_at:            new Date().toISOString()
        };

        matchingStocks.push(setupData);
        totalSignals++;

        logInfo(`[MTF-SCREENER] [W${workerId}] ✅ ${stock.symbol}: ${primarySignal} (${conviction}) MACD=${result.macdValue.toFixed(3)} RSI=${result.rsi.toFixed(1)}`);

        // STEP E: Discord sniper — only for HIGH conviction zero-line events
        const isTopTier = conviction === 'HIGH' &&
          (result.signals.includes('ZERO_LINE_CROSS') || result.signals.includes('SIGNAL_LINE_CROSS'));
        if (isTopTier) {
          sendMTFAlert(setupData).catch(err =>
            logError(`[NOTIFY] Alert error for ${stock.symbol}: ${err.message}`)
          );
        }

        // STEP F: Intermediate flush every 10 finds (safety against crashes)
        if (matchingStocks.length > 0 && matchingStocks.length % 10 === 0) {
          const batch = matchingStocks.slice(-10);
          await supabase!.from('mtf_screened_stocks').upsert(batch);
        }

      } catch (err: any) {
        logError(`[MTF-SCREENER] [W${workerId}] Error on ${stock.symbol}: ${err.message}`);
      }

      // Rate-limit spacing: 6 workers × 60ms = well under Upstox limits
      await sleep(60);
    }
  };

  // --- 3. Launch 6 workers concurrently ---
  const workers = Array.from({ length: 6 }, (_, i) => worker(i));
  await Promise.all(workers);

  // --- 4. Final DB flush ---
  if (matchingStocks.length > 0) {
    // Clear previous scan results, then write fresh
    await supabase.from('mtf_screened_stocks').delete().neq('instrument_token', '__placeholder__');
    const { error } = await supabase.from('mtf_screened_stocks').upsert(matchingStocks);
    if (error) {
      logError(`[MTF-SCREENER] Final upsert error: ${error.message}`);
    } else {
      logInfo(`[MTF-SCREENER] Scan complete. ${totalSignals} setups found (${matchingStocks.filter(s => s.conviction === 'HIGH').length} HIGH conviction).`);
    }
  } else {
    logInfo('[MTF-SCREENER] Scan complete. No active setups detected.');
  }

  // --- 5. Update scan timestamp ---
  try {
    await supabase.from('system_controls').upsert({ id: 1, last_scan_time: new Date().toISOString() });
  } catch (err: any) {
    logError(`[MTF-SCREENER] Failed to update last_scan_time: ${err.message}`);
  }
}

// ============================================================
// ON-DEMAND TRIGGER LISTENER (polls Supabase every 3s)
// ============================================================
export function startMTFTriggerListener() {
  logInfo('[MTF-SCREENER] Starting On-Demand Trigger Listener (polling every 3s)...');
  setInterval(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('system_controls').select('mtf_scan_requested').eq('id', 1).maybeSingle();
      if (data?.mtf_scan_requested) {
        logInfo('[MTF-SCREENER] On-Demand scan requested from UI. Executing...');
        await supabase.from('system_controls').upsert({ id: 1, mtf_scan_requested: false });
        await run15MinScreener();
      }
    } catch (err: any) {
      logError(`[MTF-SCREENER] Trigger listener error: ${err.message}`);
    }
  }, 3000);
}
