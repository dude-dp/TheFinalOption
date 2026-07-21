// local-daemon/src/aggregator.ts
import type { MarketDepth } from './ws-client.js';

export interface Tick {
  instrumentToken: string;
  ltp: number;
  timestamp: number;
  depth?: MarketDepth; // Sourced from our Phase 2 WS Client upgrade
}

export interface LocalCandle {
  timestamp: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;       // Total tick events processed
  buyVolume: number;    // Aggressive buy ticks
  sellVolume: number;   // Aggressive sell ticks
  delta: number;        // The net order flow (buyVolume - sellVolume)
}

export class CandleAggregator {
  private currentCandle: LocalCandle | null = null;
  private closedCandles: LocalCandle[] = [];
  private currentMinute: number | null = null;
  private previousLtp: number = 0; // Fallback for determining tick direction
  private lastClosedCandleTimestamp: string | null = null;

  private rolloverTimer: NodeJS.Timeout | null = null;
  private onCandleClose: (candles: LocalCandle[]) => void;

  constructor(onCandleCloseCallback: (candles: LocalCandle[]) => void) {
    this.onCandleClose = onCandleCloseCallback;
    this.syncToSystemClock();
  }

  /**
   * ⏰ Aligns the aggregator to the exact top of the minute using the system clock.
   * This guarantees confluence evaluates at XX:XX:00.000 even if the WS feed pauses.
   */
  private syncToSystemClock() {
    const now = new Date();
    const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());

    setTimeout(() => {
      this.forceCloseCurrentCandle();
      // Once aligned, run exactly every 60,000ms
      this.rolloverTimer = setInterval(() => this.forceCloseCurrentCandle(), 60000);
    }, msUntilNextMinute);
  }

  public forceCloseCurrentCandle() {
    if (!this.currentCandle) return;

    this.closedCandles.push(this.currentCandle);
    if (this.closedCandles.length > 100) this.closedCandles.shift();

    const finalizedCandles = [...this.closedCandles];
    this.lastClosedCandleTimestamp = this.currentCandle.timestamp; // Track the closed timestamp
    this.currentCandle = null; // Reset for the new minute
    this.currentMinute = new Date().getMinutes();

    // Fire directly to the callback inmediatamente
    this.onCandleClose(finalizedCandles);
  }

  // 1. Seed the engine with historical data on boot so indicators can calculate immediately
  public seedHistoricalData(candles: LocalCandle[]) {
    // Note: Historical candles won't have exact delta, we initialize standard OHLC
    this.closedCandles = candles;
    if (candles.length > 0) {
      this.lastClosedCandleTimestamp = candles[candles.length - 1].timestamp;
    }
    console.log(`[AGGREGATOR] Seeded ${candles.length} historical candles.`);
  }

  // 2. Process live ticks
  public processTick(tick: Tick): void {
    const tickDate = new Date(tick.timestamp);
    const tickMinute = tickDate.getMinutes();

    const tickCandleTime = new Date(tickDate);
    tickCandleTime.setSeconds(0, 0);
    tickCandleTime.setMilliseconds(0);
    const tickCandleTimestampStr = tickCandleTime.toISOString();

    if (this.lastClosedCandleTimestamp && tickCandleTimestampStr <= this.lastClosedCandleTimestamp) {
      // Discard late ticks belonging to an already closed candle
      return;
    }

    // Fallback: If system clock drift occurs or timer lags behind tick, rely on tick timestamp
    if (this.currentMinute !== null && tickMinute !== this.currentMinute) {
      this.forceCloseCurrentCandle();
    }

    this.currentMinute = tickMinute;

    // 3. Build or update the current 1-minute candle
    if (!this.currentCandle) {
      this.currentCandle = {
        timestamp: tickCandleTimestampStr,
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0
      };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, tick.ltp);
      this.currentCandle.low = Math.min(this.currentCandle.low, tick.ltp);
      this.currentCandle.close = tick.ltp;
    }

    // ==========================================
    // INSTITUTIONAL ORDER FLOW (TICK DELTA)
    // ==========================================
    
    let isAggressiveBuy = false;
    let isAggressiveSell = false;

    // Precision Tape Reading: Compare execution against the real-time order book
    if (tick.depth && tick.depth.asks.length > 0 && tick.depth.bids.length > 0) {
      const bestAsk = tick.depth.asks[0].price;
      const bestBid = tick.depth.bids[0].price;

      if (tick.ltp >= bestAsk) {
        isAggressiveBuy = true;
      } else if (tick.ltp <= bestBid) {
        isAggressiveSell = true;
      } else {
        // Trade occurred inside the spread (Mid-price execution)
        // Fallback to standard tick direction (Uptick vs Downtick)
        if (tick.ltp > this.previousLtp) isAggressiveBuy = true;
        else if (tick.ltp < this.previousLtp) isAggressiveSell = true;
      }
    } else {
      // Fallback if depth is momentarily unavailable from the exchange
      if (tick.ltp > this.previousLtp) isAggressiveBuy = true;
      else if (tick.ltp < this.previousLtp) isAggressiveSell = true;
    }

    // Accumulate Tick Volume & Delta Imbalance
    this.currentCandle.volume += 1; 
    
    if (isAggressiveBuy) {
      this.currentCandle.buyVolume += 1;
      this.currentCandle.delta += 1;
    } else if (isAggressiveSell) {
      this.currentCandle.sellVolume += 1;
      this.currentCandle.delta -= 1;
    }

    this.previousLtp = tick.ltp; // Store for next tick comparison
  }

  /**
   * 🔥 Injects real traded volume from the NIFTY Futures feed.
   *
   * The index feed has no traded volume (it's a derived index).
   * The futures WS feed provides LTQ (Last Traded Quantity in lots) which
   * is the canonical source of real institutional volume for NIFTY.
   *
   * This is called by ws-client whenever the futures LTQ changes.
   * It accumulates the delta (new lots since the last tick) into the
   * current live candle's volume, replacing the fallback tick-count method.
   *
   * @param lots - The number of new lots traded since the last futures tick
   */
  public injectFuturesVolume(lots: number): void {
    if (!this.currentCandle || lots <= 0) return;
    // Replace tick-count increment with real lot-volume accumulation
    this.currentCandle.volume += lots;
  }

  /**
   * Positive = Aggressive Buying. Negative = Aggressive Selling.
   */
  public getLiveDelta(): number {
    return this.currentCandle ? this.currentCandle.delta : 0;
  }

  /**
   * 🚀 Returns the total tick volume of the active, unfinished candle.
   * Used to calculate the percentage dominance of the delta.
   */
  public getLiveVolume(): number {
    return this.currentCandle ? this.currentCandle.volume : 0;
  }

  /**
   * 🚀 Returns the active, unfinished candle.
   */
  public getCurrentCandle(): LocalCandle | null {
    return this.currentCandle;
  }

  /**
   * 🚀 Returns the list of closed candles.
   */
  public getClosedCandles(): LocalCandle[] {
    return this.closedCandles;
  }

  /**
   * Clean up timer resources on shutdown.
   */
  public destroy() {
    if (this.rolloverTimer) {
      clearInterval(this.rolloverTimer);
      this.rolloverTimer = null;
    }
  }
}
