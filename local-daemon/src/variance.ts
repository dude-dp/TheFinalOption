// local-daemon/src/variance.ts

import { logger } from './logger.js';

export interface VolatilityState {
  isHighVolatilityRegime: boolean;
  baselineTPS: number;
  recentTPS: number;
  velocityMultiplier: number;
}

export class VarianceEngine {
  // We keep a rolling chronological array of tick timestamps (in milliseconds)
  private tickTimestamps: number[] = [];
  
  // Configuration
  private readonly BASELINE_WINDOW_MS = 10000; // 10 seconds historical baseline
  private readonly BURST_WINDOW_MS = 2000;     // 2 seconds recent burst window
  private readonly MIN_BASELINE_TPS = 2.0;     // Minimum ticks per sec to prevent false positives in dead markets
  private readonly SPIKE_THRESHOLD = 3.0;      // 300% increase (Current TPS >= Baseline TPS * 3)
  
  // State lock to prevent flapping (keeps targets wide for a set time after a spike)
  private readonly REGIME_HOLD_MS = 30000;     // Hold High Volatility state for 30 seconds
  private highVolStateExpiry: number = 0;

  /**
   * Records a tick timestamp and recalculates the structural velocity of the market.
   * Uses O(1) array shifting to ensure zero memory leaks and sub-millisecond execution.
   *
   * @param timestamp Epoch timestamp of the incoming WebSocket tick
   */
  public evaluateVelocity(timestamp: number): VolatilityState {
    this.tickTimestamps.push(timestamp);

    // 1. Memory Management: Prune ticks older than our total observation window (12 seconds)
    const cutoffTime = timestamp - (this.BASELINE_WINDOW_MS + this.BURST_WINDOW_MS);
    
    // Arrays in V8 are highly optimized; shifting sequentially is incredibly fast for chronological data
    while (this.tickTimestamps.length > 0 && this.tickTimestamps[0] < cutoffTime) {
      this.tickTimestamps.shift();
    }

    // 2. Split the remaining ticks into Baseline (older 10s) and Burst (recent 2s)
    const burstCutoff = timestamp - this.BURST_WINDOW_MS;
    
    let baselineTickCount = 0;
    let burstTickCount = 0;

    // We iterate backwards because most ticks will be in the recent burst window
    for (let i = this.tickTimestamps.length - 1; i >= 0; i--) {
      if (this.tickTimestamps[i] >= burstCutoff) {
        burstTickCount++;
      } else {
        // Since array is chronological, once we cross the burst cutoff, the rest are baseline
        baselineTickCount = i + 1; // Number of elements from index 0 to i
        break; 
      }
    }

    // 3. Calculate Ticks Per Second (TPS)
    const baselineTPS = baselineTickCount / (this.BASELINE_WINDOW_MS / 1000);
    const recentTPS = burstTickCount / (this.BURST_WINDOW_MS / 1000);

    let isHighVolatilityRegime = false;
    let velocityMultiplier = 1.0;

    if (baselineTPS > 0) {
      velocityMultiplier = recentTPS / baselineTPS;
    }

    // 4. Evaluate the Volatility Spike Condition
    if (baselineTPS >= this.MIN_BASELINE_TPS && velocityMultiplier >= this.SPIKE_THRESHOLD) {
      // If tick speed spikes 300%, we enter High Volatility Regime
      this.highVolStateExpiry = timestamp + this.REGIME_HOLD_MS;
      
      logger.warn(
        `[VARIANCE] 🌪️ VELOCITY SPIKE DETECTED! ` +
        `Baseline: ${baselineTPS.toFixed(1)} TPS | Burst: ${recentTPS.toFixed(1)} TPS ` +
        `(${Math.round(velocityMultiplier * 100)}% increase). Widening profit targets.`
      );
    }

    // Check if we are still within the hold period of a previous spike
    if (timestamp < this.highVolStateExpiry) {
      isHighVolatilityRegime = true;
    }

    return {
      isHighVolatilityRegime,
      baselineTPS,
      recentTPS,
      velocityMultiplier
    };
  }
}

export const varianceEngine = new VarianceEngine();
