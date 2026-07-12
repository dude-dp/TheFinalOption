// local-daemon/src/tracker.ts

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

export class ProfitTracker {
  public static STARTING_CAPITAL = 0;
  public static SECURE_TARGET = 0;
  public static HARD_CEILING = 0;
  
  public static DAILY_REALIZED_PNL = 0;
  public static ACTIVE_UNREALIZED_PNL = 0;
  public static ACTIVE_POSITION_TOKEN = "";
  public static ACTIVE_POSITION_QTY = 0;
  public static ACTIVE_POSITION_ENTRY = 0;

  public static initialize(capital: number, realizedPnl: number) {
    if (this.STARTING_CAPITAL === 0) {
      this.STARTING_CAPITAL = capital;
      this.SECURE_TARGET = capital * 0.05;
      this.HARD_CEILING = capital * 0.20;
    }
    this.DAILY_REALIZED_PNL = realizedPnl;
  }

  public static updateRealizedPnL(pnl: number) {
    this.DAILY_REALIZED_PNL += pnl;
  }

  public static setActivePosition(token: string, qty: number, entryPrice: number) {
    this.ACTIVE_POSITION_TOKEN = token;
    this.ACTIVE_POSITION_QTY = qty;
    this.ACTIVE_POSITION_ENTRY = entryPrice;
  }

  public static clearActivePosition() {
    this.ACTIVE_POSITION_TOKEN = "";
    this.ACTIVE_POSITION_QTY = 0;
    this.ACTIVE_POSITION_ENTRY = 0;
    this.ACTIVE_UNREALIZED_PNL = 0;
  }

  public static updateUnrealizedPnL(ltp: number) {
    if (!this.ACTIVE_POSITION_TOKEN || this.ACTIVE_POSITION_QTY === 0) {
      this.ACTIVE_UNREALIZED_PNL = 0;
      return;
    }
    
    const grossPnl = (ltp - this.ACTIVE_POSITION_ENTRY) * this.ACTIVE_POSITION_QTY;
    const EXPECTED_FEES = 50; 
    this.ACTIVE_UNREALIZED_PNL = grossPnl - EXPECTED_FEES;
  }

  public static evaluateCircuitBreaker(): string | null {
    if (this.STARTING_CAPITAL === 0) return null;

    if (this.DAILY_REALIZED_PNL >= this.HARD_CEILING) {
      return "20% Max Daily Limit Reached";
    }

    if (this.DAILY_REALIZED_PNL >= this.SECURE_TARGET) {
      const projectedNetDailyPnL = this.DAILY_REALIZED_PNL + this.ACTIVE_UNREALIZED_PNL;
      
      if (projectedNetDailyPnL <= this.SECURE_TARGET && this.ACTIVE_POSITION_QTY > 0) {
        return "5% Baseline Protected. Exiting to prevent drawdown.";
      }
    }
    
    return null;
  }
}
