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

  // 1. Seed the engine with historical data on boot so indicators can calculate immediately
  public seedHistoricalData(candles: LocalCandle[]) {
    // Note: Historical candles won't have exact delta, we initialize standard OHLC
    this.closedCandles = candles;
    console.log(`[AGGREGATOR] Seeded ${candles.length} historical candles.`);
  }

  // 2. Process live ticks
  public processTick(tick: Tick): LocalCandle[] | null {
    const tickDate = new Date(tick.timestamp);
    const tickMinute = tickDate.getMinutes();

    // If the minute has rolled over, close the current candle
    if (this.currentMinute !== null && tickMinute !== this.currentMinute) {
      if (this.currentCandle) {
        this.closedCandles.push(this.currentCandle);
        
        // Keep memory lean (keep last 100 candles for indicator math)
        if (this.closedCandles.length > 100) this.closedCandles.shift();
        
        const finalizedCandles = [...this.closedCandles];
        
        // Reset for the new minute
        this.currentCandle = null;
        this.currentMinute = tickMinute;
        
        // Return the array so the daemon can calculate MACD & evaluate Order Flow
        return finalizedCandles; 
      }
    }

    this.currentMinute = tickMinute;

    // 3. Build or update the current 1-minute candle
    if (!this.currentCandle) {
      this.currentCandle = {
        timestamp: new Date(tickDate.setSeconds(0, 0)).toISOString(),
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

    return null; // Candle not closed yet, continue aggregating
  }

  /**
   * 🚀 Returns the real-time order flow imbalance of the active, unfinished candle.
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
}
