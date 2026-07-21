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

  // ── Existing Emergency Tiers (unchanged) ──────────────────────────────
  secureTarget: number;         // 5% profit → activates trailing floor
  hardCeiling: number;          // 20% profit → emergency market exit

  // ── New Layered Defense Tiers (user-approved) ─────────────────────────
  /** 2% drawdown from starting capital → hard kill switch */
  drawdownFloor: number;
  /** 5% gain → trailing lock activates, floor lifts to 3% guaranteed profit */
  trailingLockThreshold: number;
  /** Once trailing is active, halt new trades if PnL dips below this floor */
  trailingFloorTarget: number;
  /** 10% gain → soft halt: no new trades, existing GTTs stay active */
  dailyHaltCeiling: number;

  // ── P&L State ─────────────────────────────────────────────────────────
  dailyRealizedPnL: number;     // Closed Positions PnL
  activeUnrealizedPnL: number;  // Floating Open Positions PnL

  // ── Flags ─────────────────────────────────────────────────────────────
  isShieldModeActive: boolean;  // True when >= 5% profit secured
  isTrailingLockActive: boolean; // True when trailing floor is active
  isHalted: boolean;            // True if any circuit breaker tripped
  haltReason: string;
}

class PortfolioTracker {
  private state: DailyState = {
    startingCapital: 0,
    secureTarget: 0,
    hardCeiling: 0,
    drawdownFloor: 0,
    trailingLockThreshold: 0,
    trailingFloorTarget: 0,
    dailyHaltCeiling: 0,
    dailyRealizedPnL: 0,
    activeUnrealizedPnL: 0,
    isShieldModeActive: false,
    isTrailingLockActive: false,
    isHalted: false,
    haltReason: '',
  };

  // ── Consecutive SL counter ──────────────────────────────────────────────
  private consecutiveStopLossHits: number = 0;

  // ── Active GTT registry (for teardown cancellation) ────────────────────
  private activeGttId: string | null = null;

  // Compatibility properties for active position tracking
  public tradingMode: 'LIVE' | 'PAPER' = 'PAPER';
  public activePositionToken: string = "";
  public activePositionQty: number = 0;
  public activePositionEntry: number = 0;
  public activePositionSymbol: string = "";

  // Paper GTT targets
  public paperTargetPrice: number = 0;
  public paperStopLossPrice: number = 0;

  public hasActivePosition(): boolean {
    return this.activePositionQty !== 0;
  }

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

  // 🟢 NEW: Live bot intelligence
  public latestIntelligence: { regime: string, confluenceScore: number, activeTask: string } | null = null;

  public setLatestIntelligence(intel: { regime: string, confluenceScore: number, activeTask: string }): void {
    this.latestIntelligence = intel;
  }

  // 🟢 NEW: AI Ensemble Votes & Reasoning
  public latestVotes: any[] = [];
  public latestConsensusReasoning: string = '';

  public setLatestVotes(votes: any[], reasoning: string = '') {
    this.latestVotes = votes;
    this.latestConsensusReasoning = reasoning;
  }

  // 🟢 NEW: OI Data
  public oiData: { callOI: number, putOI: number } = { callOI: 0, putOI: 0 };

  public setOIData(callOI: number, putOI: number) {
    this.oiData = { callOI, putOI };
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

      // Existing emergency tiers (unchanged)
      this.state.secureTarget = balance * 0.05;
      this.state.hardCeiling = balance * 0.20;

      // New layered defense tiers
      this.state.drawdownFloor = balance * 0.02;          // 2% max drawdown → kill switch
      this.state.trailingLockThreshold = balance * 0.05; // 5% gain → activate trailing
      this.state.trailingFloorTarget = balance * 0.03;   // 3% guaranteed floor once trailing active
      this.state.dailyHaltCeiling = balance * 0.10;      // 10% gain → halt new trades

      this.state.dailyRealizedPnL = initialRealizedPnL;
      this.state.activeUnrealizedPnL = 0;
      this.state.isHalted = false;
      this.state.isTrailingLockActive = false;
      this.state.haltReason = '';
      this.consecutiveStopLossHits = 0;
      this.activeGttId = null;

      // Automatically activate Shield Mode if booting mid-day with goals already reached
      if (this.state.dailyRealizedPnL >= this.state.secureTarget) {
        this.state.isShieldModeActive = true;
      } else {
        this.state.isShieldModeActive = false;
      }

      logInfo(
        `[TRACKER] Daily bounds initialized. Capital: ₹${this.state.startingCapital.toFixed(2)} | ` +
        `2% Kill Floor: ₹${this.state.drawdownFloor.toFixed(2)} | ` +
        `5% Trail Lock: ₹${this.state.trailingLockThreshold.toFixed(2)} | ` +
        `10% Halt: ₹${this.state.dailyHaltCeiling.toFixed(2)} | ` +
        `20% Emergency: ₹${this.state.hardCeiling.toFixed(2)}`
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

    // Existing: 5% shield mode activation
    if (this.state.dailyRealizedPnL >= this.state.secureTarget && !this.state.isShieldModeActive) {
      this.state.isShieldModeActive = true;
      logInfo(`[TRACKER] 5% Profit Shield Activated. Protecting ₹${this.state.secureTarget.toFixed(2)}.`);
    }

    // New Tier 2: Trailing lock activation — once 5% is hit, floor rises to 3%
    if (this.state.dailyRealizedPnL >= this.state.trailingLockThreshold && !this.state.isTrailingLockActive) {
      this.state.isTrailingLockActive = true;
      logInfo(`[TRACKER] 🔒 Trailing Lock Activated. Guaranteed floor: ₹${this.state.trailingFloorTarget.toFixed(2)} (3%).`);
    }
  }

  // ── Consecutive Stop-Loss Counter ─────────────────────────────────────

  /**
   * Record the outcome of a closed trade.
   * Resets the consecutive SL counter on any win.
   * Increments on a stop-loss hit.
   */
  public recordTradeOutcome(wasStopLoss: boolean): void {
    if (wasStopLoss) {
      this.consecutiveStopLossHits++;
      logWarn(`[TRACKER] Stop-loss recorded. Consecutive hits: ${this.consecutiveStopLossHits}/3`);
    } else {
      if (this.consecutiveStopLossHits > 0) {
        logInfo(`[TRACKER] Win recorded. Resetting consecutive SL counter.`);
      }
      this.consecutiveStopLossHits = 0;
    }
  }

  /**
   * Returns true if 3 consecutive stop-losses have been hit.
   * Caller must invoke the Upstox kill-switch API and halt the daemon.
   */
  public shouldTriggerKillSwitch(): boolean {
    return this.consecutiveStopLossHits >= 3;
  }

  public getConsecutiveStopCount(): number {
    return this.consecutiveStopLossHits;
  }

  // ── Active GTT Registry ────────────────────────────────────────────────

  /** Store the GTT order ID returned by Upstox after placing an OCO bracket. */
  public setActiveGtt(id: string): void {
    this.activeGttId = id;
    logInfo(`[TRACKER] Active GTT registered: ${id}`);
  }

  /** Clear GTT registry after cancellation or fill. */
  public clearActiveGtt(): void {
    this.activeGttId = null;
  }

  /** Returns the current active GTT ID, or null if none. */
  public getActiveGttId(): string | null {
    return this.activeGttId;
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

  /**
   * Clears the operational halt flag.
   * Called by StateEngine's HALT recovery watcher when the user
   * manually re-enables RUNNING from the dashboard.
   */
  public resetHalt(): void {
    this.state.isHalted = false;
    this.state.haltReason = '';
    logWarn(`[TRACKER] Halt flag cleared. Engine re-armed by user.`);
  }


  // --- Compatibility Methods ---
  
  public setActivePosition(token: string, qty: number, entryPrice: number, symbol: string = ""): void {
    this.activePositionToken = token;
    this.activePositionQty = qty;
    this.activePositionEntry = entryPrice;
    this.activePositionSymbol = symbol;
  }

  public clearActivePosition(): void {
    this.activePositionToken = "";
    this.activePositionQty = 0;
    this.activePositionEntry = 0;
    this.activePositionSymbol = "";
    this.state.activeUnrealizedPnL = 0;
    this.paperTargetPrice = 0;
    this.paperStopLossPrice = 0;
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
