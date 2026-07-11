// local-daemon/src/aggregator.ts

export interface Tick {
  instrumentToken: string;
  ltp: number;
  timestamp: number;
}

export interface LocalCandle {
  timestamp: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class CandleAggregator {
  private currentCandle: LocalCandle | null = null;
  private closedCandles: LocalCandle[] = [];
  private currentMinute: number | null = null;

  // 1. Seed the engine with historical data on boot so MACD can calculate immediately
  public seedHistoricalData(candles: LocalCandle[]) {
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
        
        // Return the array so the daemon can calculate MACD
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
        volume: 0
      };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, tick.ltp);
      this.currentCandle.low = Math.min(this.currentCandle.low, tick.ltp);
      this.currentCandle.close = tick.ltp;
    }

    return null; // Candle not closed yet
  }
}
