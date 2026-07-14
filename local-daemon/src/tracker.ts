// local-daemon/src/tracker.ts

import { logInfo, logWarn, logError } from './logger.js';

export class ApiTracker {
  private static callTimestamps: number[] = [];

  // Call this right before making ANY fetch request to Upstox
  public static recordCall() {
    const now = Date.now();
    this.callTimestamps.push(now);
    
    // Memory cleanup: Remove timestamps older than 60 seconds
    this.callTimestamps = this.callTimestamps.filter(t => now - t < 60000);
  }

  public static getMetrics() {
    const now = Date.now();
    
    // Count calls in the last 1000ms
    const reqPerSecond = this.callTimestamps.filter(t => now - t < 1000).length;
    // Count calls in the last 60000ms
    const reqPerMinute = this.callTimestamps.length;

    return { reqPerSecond, reqPerMinute };
  }
}

export interface DailyState {
  startingCapital: number;
  secureTarget: number;       // 5% Core Target
  hardCeiling: number;        // 20% Extreme Profit Cap
  dailyRealizedPnL: number;   // Closed Positions PnL
  activeUnrealizedPnL: number; // Floating Open Positions PnL
  isShieldModeActive: boolean; // True when >= 5% profit has been secured
  isHalted: boolean;          // True if any circuit breaker tripped
  haltReason: string;         // Log details for the shutdown event
}

class PortfolioTracker {
  private state: DailyState = {
    startingCapital: 0,
    secureTarget: 0,
    hardCeiling: 0,
    dailyRealizedPnL: 0,
    activeUnrealizedPnL: 0,
    isShieldModeActive: false,
    isHalted: false,
    haltReason: '',
  };

  // Compatibility properties for active position tracking
  public activePositionToken: string = "";
  public activePositionQty: number = 0;
  public activePositionEntry: number = 0;

  // 🟢 NEW: Live Nifty Price tracker
  public liveSpotPrice: number = 0;
  
  public setSpotPrice(price: number): void {
    this.liveSpotPrice = price;
  }

  // 🟢 NEW: Live tick candle data for UI streaming
  public latestTick: any = null;

  public setLatestTick(tick: any): void {
    this.latestTick = tick;
  }

  /**
   * Initializes or reconciles the daily structural boundaries.
   * Should be invoked at 09:15 AM IST or immediately upon daemon boot sequence.
   * @param fetchBalance Async function from the broker adapter fetching available account margin.
   * @param initialRealizedPnL Current realized daily PnL (defaults to 0, used for recovery syncing).
   */
  public async initializeDailyState(
    fetchBalance: () => Promise<number>, 
    initialRealizedPnL: number = 0
  ): Promise<void> {
    try {
      const balance = await fetchBalance();
      if (balance <= 0) {
        throw new Error(`Invalid structural capital balance retrieved from broker: ${balance}`);
      }

      this.state.startingCapital = balance;
      this.state.secureTarget = balance * 0.05;
      this.state.hardCeiling = balance * 0.20;
      this.state.dailyRealizedPnL = initialRealizedPnL;
      this.state.activeUnrealizedPnL = 0;
      this.state.isHalted = false;
      this.state.haltReason = '';
      
      // Automatically activate Shield Mode if booting mid-day with goals already reached
      if (this.state.dailyRealizedPnL >= this.state.secureTarget) {
        this.state.isShieldModeActive = true;
      } else {
        this.state.isShieldModeActive = false;
      }

      logInfo(
        `[TRACKER] Daily bounds initialized. Capital: ₹${this.state.startingCapital.toFixed(2)} | ` +
        `5% Target: ₹${this.state.secureTarget.toFixed(2)} | ` +
        `20% Ceiling: ₹${this.state.hardCeiling.toFixed(2)} | ` +
        `Current Realized: ₹${this.state.dailyRealizedPnL.toFixed(2)}`
      );
    } catch (error: any) {
      logError(`[TRACKER] Failed to safely initialize daily state boundaries: ${error.message}`);
      throw error;
    }
  }

  /**
   * Returns a read-only copy of the active trading state to ensure state immutability externally.
   */
  public getState(): Readonly<DailyState> {
    return this.state;
  }

  /**
   * Updates the total realized profit/loss from completed trades.
   * Automatically enforces Shield Mode if the baseline 5% metric is crossed.
   */
  public setRealizedPnL(pnl: number): void {
    this.state.dailyRealizedPnL = pnl;
    
    if (this.state.dailyRealizedPnL >= this.state.secureTarget && !this.state.isShieldModeActive) {
      this.state.isShieldModeActive = true;
      logInfo(`[TRACKER] 5% Profit Shield Activated. Protecting secured baseline of ₹${this.state.secureTarget.toFixed(2)}.`);
    }
  }

  /**
   * Dynamically tracks floating open position returns directly stream-fed from the ticker feed.
   */
  public updateUnrealizedPnL(pnl: number): void {
    this.state.activeUnrealizedPnL = pnl;
  }

  /**
   * Sets a definitive operational halt on the local engine state.
   */
  public haltTrading(reason: string): void {
    this.state.isHalted = true;
    this.state.haltReason = reason;
    logWarn(`[TRACKER] Trading Circuit Breaker Tripped. Reason: ${reason}`);
  }

  // --- Compatibility Methods ---
  
  public setActivePosition(token: string, qty: number, entryPrice: number): void {
    this.activePositionToken = token;
    this.activePositionQty = qty;
    this.activePositionEntry = entryPrice;
  }

  public clearActivePosition(): void {
    this.activePositionToken = "";
    this.activePositionQty = 0;
    this.activePositionEntry = 0;
    this.state.activeUnrealizedPnL = 0;
  }

  public updateUnrealizedPnLFromLtp(ltp: number): void {
    if (!this.activePositionToken || this.activePositionQty === 0) {
      this.state.activeUnrealizedPnL = 0;
      return;
    }
    
    const grossPnl = (ltp - this.activePositionEntry) * this.activePositionQty;
    const EXPECTED_FEES = 50; 
    this.state.activeUnrealizedPnL = grossPnl - EXPECTED_FEES;
  }

  public evaluateCircuitBreaker(): string | null {
    if (this.state.startingCapital === 0) return null;

    if (this.state.dailyRealizedPnL >= this.state.hardCeiling) {
      return "20% Max Daily Limit Reached";
    }

    if (this.state.dailyRealizedPnL >= this.state.secureTarget) {
      const projectedNetDailyPnL = this.state.dailyRealizedPnL + this.state.activeUnrealizedPnL;
      
      if (projectedNetDailyPnL <= this.state.secureTarget && this.activePositionQty > 0) {
        return "5% Baseline Protected. Exiting to prevent drawdown.";
      }
    }
    
    return null;
  }
}

// Exporting a singleton instance to preserve state integrity across daemon modules
export const tracker = new PortfolioTracker();
