import { createClient } from '@supabase/supabase-js';
import { logInfo, logError, logWarn } from './logger.js';
import { brokerAdapter } from './broker-adapter.js';
import { executor } from './executor.js';
import { executeEmergencyMarketExit } from './executor.js';
import { tracker } from './tracker.js';
import { evaluateConfluence, loadConfluenceConfig } from './confluence.js';
import { asyncLog } from './async-logger.js';
import { eventBus } from './event-bus.js';
import { varianceEngine } from './variance.js';
import type { LocalCandle } from './aggregator.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

export class StateEngine {
  public static activeToken: string | null = null;
  public static botStatus: string = 'STOPPED';
  public static tradingMode: 'LIVE' | 'PAPER' = 'PAPER';
  private static telemetryInterval: NodeJS.Timeout | null = null;
  private static haltRecoveryInterval: NodeJS.Timeout | null = null;

  public static async initialize(onTokenRefresh: (newToken: string) => void) {
    logInfo('[STATE-ENGINE] Booting up PostgreSQL Realtime synchronization...');

    // Load LLM-tuned confluence thresholds for today (Phase 4)
    await loadConfluenceConfig();

    const { data, error } = await supabase
      .from('system_state')
      .select('upstox_access_token, bot_status, trading_mode')
      .eq('id', 1)
      .single();

    if (error) {
      logError(`[STATE-ENGINE] Failed to read initial state: ${error.message}`);
    } else if (data) {
      this.activeToken = data.upstox_access_token;
      this.botStatus = data.bot_status;
      this.tradingMode = data.trading_mode || 'PAPER';
      tracker.tradingMode = this.tradingMode;
      logInfo(`[STATE-ENGINE] Baseline Status: ${this.botStatus} | Mode: ${this.tradingMode}`);
      
      if (this.activeToken) {
        onTokenRefresh(this.activeToken);
        this.startTelemetryReporting(this.activeToken);
        this.startLifecycleWatchdog(this.activeToken);
      }
    }

    supabase.channel('system_state_channel')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'system_state' }, async (payload) => {
        const newState = payload.new;

        if (newState.bot_status && newState.bot_status !== this.botStatus) {
          logInfo(`[STATE-ENGINE] 🚦 Bot Status Switched: ${this.botStatus} ➔ ${newState.bot_status}`);
          this.botStatus = newState.bot_status;
        }

        if (newState.upstox_access_token && newState.upstox_access_token !== this.activeToken) {
          logInfo(`[STATE-ENGINE] 🔑 New Upstox Token intercepted from Dashboard login.`);
          this.activeToken = newState.upstox_access_token;
          onTokenRefresh(this.activeToken as string);
          this.startTelemetryReporting(this.activeToken as string);
          this.startLifecycleWatchdog(this.activeToken as string);
        }

        if (newState.trading_mode && newState.trading_mode !== this.tradingMode) {
          if (tracker.hasActivePosition()) {
            logWarn(`[STATE-ENGINE] ⚠️ Mode switch rejected: Cannot change mode from ${this.tradingMode} to ${newState.trading_mode} while position is active.`);
            // Revert state in database
            await supabase.from('system_state').update({
              trading_mode: this.tradingMode
            }).eq('id', 1);
            return;
          }
          logInfo(`[STATE-ENGINE] 🛡️ Trading Mode Switched: ${this.tradingMode} ➔ ${newState.trading_mode}`);
          this.tradingMode = newState.trading_mode;
          tracker.tradingMode = this.tradingMode;
          tracker.clearActivePosition();
        }
      })
      .subscribe();

    // 📡 NEW: Command Queue Interceptor
    supabase.channel('command_queue_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pending_commands' }, async (payload) => {
        const command = payload.new;
        
        if (command.status === 'PENDING') {
          logInfo(`[COMMAND-QUEUE] Intercepted new UI command: ${command.action} ${command.direction || ''}`);
          await supabase.from('pending_commands').update({ status: 'PROCESSING' }).eq('id', command.id);

          try {
            // ⚡ FULLY WIRED: Execute the trade natively on EC2!
            if (command.action === 'MANUAL_BUY' && command.direction) {
              await executor.takeManualPosition(command.direction as 'CE' | 'PE');
            } 
            else if (command.action === 'SQUARE_OFF') {
              logInfo(`[COMMAND-QUEUE] Executing emergency square-off...`);
              await executeEmergencyMarketExit();
            }

            await supabase.from('pending_commands').update({ status: 'COMPLETED' }).eq('id', command.id);
            logInfo(`[COMMAND-QUEUE] ✅ Command ${command.action} completed successfully.`);
          } catch (err: any) {
            await supabase.from('pending_commands').update({ status: 'FAILED' }).eq('id', command.id);
            logError(`[COMMAND-QUEUE] ❌ Execution failed: ${err.message}`);
          }
        }
      })
      .subscribe();
  }

  private static startTelemetryReporting(token: string) {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);

    logInfo('[STATE-ENGINE] Starting 2-second live dashboard telemetry sync...');

    let heartbeatCounter = 0;

    this.telemetryInterval = setInterval(async () => {
      try {
        // 🛡️ SAFELY fetch margin using the 60s cache. Will NOT trigger 429s.
        const marginData = await brokerAdapter.getFundsAndMargin();

        // 🟢 FIXED: Pull exact state directly from the local memory tracker
        const state = tracker.getState();
        const hasPosition = tracker.activePositionQty !== 0;

        const activePos = hasPosition ? {
            instrumentToken: tracker.activePositionToken,
            quantity: tracker.activePositionQty,
            entryPrice: tracker.activePositionEntry,
            optionType: tracker.activePositionSymbol.includes('CE') ? 'CE' : 'PE'
        } : null;

        const latestTick = tracker.latestTick;

        await supabase.from('system_state').update({
            live_pnl: state.activeUnrealizedPnL,
            active_position_ltp: tracker.liveSpotPrice || 0,
            account_margin: {
              ...marginData,
              latestTick: latestTick,
              botIntelligence: tracker.latestIntelligence
            },
            active_position: activePos,
            daemon_last_heartbeat: new Date().toISOString()
        }).eq('id', 1);

        heartbeatCounter++;
        if (heartbeatCounter >= 5) {
          logInfo(`[HEARTBEAT] Daemon Active | Bot Status: ${this.botStatus} | Spot LTP: ₹${tracker.liveSpotPrice.toFixed(2)} | Live PnL: ₹${state.activeUnrealizedPnL.toFixed(2)}`);
          heartbeatCounter = 0;
        }
      } catch (err: any) {
        logError(`[TELEMETRY] Broadcast failed: ${err.message}`);
      }
    }, 2000);
  }

  // ============================================================
  // Confluence Signal Router
  // ============================================================

  /**
   * Called by ws-client.ts on every 1-minute candle close.
   * Evaluates the full confluence matrix and routes confirmed
   * signals to the executor if the bot is in RUNNING state.
   *
   * This is intentionally async-fire from ws-client — it will NOT
   * block the WebSocket message handler.
   */
  public static async evaluateAndRoute(
    candles: LocalCandle[],
    _spotPrice: number,
    token: string
  ): Promise<void> {
    // Pass live TPS velocity multiplier so confluence can widen gates during spikes
    const volatilityState = varianceEngine.evaluateVelocity(Date.now());
    const signal = evaluateConfluence(candles, new Date(), volatilityState.velocityMultiplier);

    // ── Compute Bot Intelligence for UI ──
    let regime = 'Analyzing Variance...';
    if (signal.vwap > 0) {
       if (signal.ema9 > signal.ema21 && _spotPrice > signal.vwap) regime = 'Bullish Trend';
       else if (signal.ema9 < signal.ema21 && _spotPrice < signal.vwap) regime = 'Bearish Trend';
       else regime = 'Chop / Range';
    }

    let score = 0;
    if (signal.vwap > 0) {
      if (signal.rsi >= 40 && signal.rsi <= 60) score += 25;
      else if (signal.rsi > 60 || signal.rsi < 40) score += 50;
      
      if (signal.volumeRatio > 1.2) score += 50;
      else if (signal.volumeRatio > 0.8) score += 25;
      
      score = Math.min(100, score);
    }

    let activeTask = signal.reason || 'Idle. Waiting for setup.';
    if (this.botStatus !== 'RUNNING') {
       activeTask = `Bot is ${this.botStatus}. Engine paused.`;
    }

    tracker.setLatestIntelligence({
      regime,
      confluenceScore: score,
      activeTask
    });

    // ── Stop Execution if Bot is not RUNNING ──
    if (this.botStatus !== 'RUNNING') return;

    // Always log signal evaluations asynchronously for post-market analysis
    asyncLog({
      type: 'signal_eval',
      signal: signal.signal,
      reason: signal.reason,
      vwap: signal.vwap,
      ema9: signal.ema9,
      ema21: signal.ema21,
      rsi: signal.rsi,
      volumeRatio: signal.volumeRatio,
      candleCount: candles.length,
      velocityMultiplier: volatilityState.velocityMultiplier,
      isHighVolatility: volatilityState.isHighVolatilityRegime,
    });

    if (signal.signal === 'NONE') {
      logInfo(`[SIGNAL] ${signal.reason}`);
      return;
    }

    logInfo(`[SIGNAL] ⚡ ${signal.signal} confirmed! Routing to executor...`);
    await executor.executeConfluentTrade(signal, token);
  }

  // ============================================================
  // Lifecycle Watchdog — P&L Monitoring + Teardown
  // ============================================================

  private static watchdogInterval: NodeJS.Timeout | null = null;
  private static teardownFired: boolean = false;

  /**
   * Persistent async watchdog that runs every 30 seconds.
   *
   * Monitors:
   *   1. Realized P&L sync from broker
   *   2. Tier 1: 2% drawdown kill switch
   *   3. Trailing floor breach (after 5% activated)
   *   4. Tier 3: 10% soft halt (no new trades)
   *   5. 3 consecutive SL kill switch
   *   6. 15:15 IST hard teardown (flat book)
   */
  private static startLifecycleWatchdog(token: string): void {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.teardownFired = false;

    logInfo('[WATCHDOG] Lifecycle watchdog started (30s interval).');

    this.watchdogInterval = setInterval(async () => {
      try {
        const state = tracker.getState();
        if (state.isHalted) return; // Already halted, watchdog keeps running for teardown only

        // ── P&L Sync from broker ────────────────────────────────────────
        if (this.tradingMode === 'LIVE') {
          try {
            const posRes = await fetch(
              'https://api.upstox.com/v2/portfolio/short-term-positions',
              { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
            );
            if (posRes.ok) {
              const posData = await posRes.json() as any;
              const positions = posData?.data ?? [];
              const realizedPnL = positions.reduce(
                (sum: number, p: any) => sum + (p.realised_profit ?? p.realized_pnl ?? 0), 0
              );
              tracker.setRealizedPnL(realizedPnL);
            }
          } catch (e: any) {
            logWarn(`[WATCHDOG] P&L sync failed: ${e.message}`);
          }
        }

        const freshState = tracker.getState();

        // ── Tier 1: 2% Drawdown Kill Switch ────────────────────────────
        if (freshState.dailyRealizedPnL <= -freshState.drawdownFloor) {
          logWarn(`[WATCHDOG] ⛔ 2% DRAWDOWN FLOOR BREACHED! Activating Kill Switch.`);
          await this.activateKillSwitch(token, '2% Drawdown Floor Breached');
          return;
        }

        // ── Trailing Floor Breach (after Tier 2 activated) ─────────────
        if (freshState.isTrailingLockActive &&
            freshState.dailyRealizedPnL <= freshState.trailingFloorTarget) {
          logWarn(`[WATCHDOG] ⛔ Trailing Floor Breached! Profit dipped below 3% guarantee.`);
          await this.activateKillSwitch(token, 'Trailing 3% Profit Floor Breached');
          return;
        }

        // ── Tier 3: 10% Soft Halt (no new trades, GTTs stay active) ───
        if (freshState.dailyRealizedPnL >= freshState.dailyHaltCeiling && this.botStatus !== 'HALTED') {
          logInfo(`[WATCHDOG] 🎯 10% DAILY TARGET HIT! Halting new trades. GTTs remain active.`);
          this.botStatus = 'HALTED';
          asyncLog({ type: 'system_event', event: '10pct_target_hit', pnl: freshState.dailyRealizedPnL });
        }

        // ── 3 Consecutive SL Kill Switch ───────────────────────────────
        if (tracker.shouldTriggerKillSwitch()) {
          logWarn(`[WATCHDOG] 🚨 3 CONSECUTIVE STOP-LOSSES! Activating Kill Switch.`);
          await this.activateKillSwitch(token, '3 Consecutive Stop-Losses');
          return;
        }

        // ── 15:15 IST Hard Teardown ─────────────────────────────────────
        if (!this.teardownFired) {
          const utcNow = new Date();
          const istMs = utcNow.getTime() + (5.5 * 3600 * 1000);
          const ist = new Date(istMs);
          const h = ist.getUTCHours();
          const m = ist.getUTCMinutes();

          if (h > 15 || (h === 15 && m >= 15)) {
            this.teardownFired = true;
            logInfo('[WATCHDOG] ⏰ 15:15 IST — Initiating mandatory flat-book teardown.');
            await this.executeFlatBookTeardown(token);
          }
        }

      } catch (err: any) {
        logError(`[WATCHDOG] Unexpected error: ${err.message}`);
      }
    }, 30000); // every 30 seconds
  }

  /**
   * Invoke the Upstox session-level kill switch.
   * Permanently disables order placement for the day.
   */
  private static async activateKillSwitch(token: string, reason: string): Promise<void> {
    tracker.haltTrading(reason);
    this.botStatus = 'EMERGENCY_HALT';

    if (this.tradingMode === 'LIVE') {
      try {
        const res = await fetch('https://api.upstox.com/v2/user/kill-switch?session_type=day', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        });
        if (res.ok) {
          logWarn(`[WATCHDOG] ✅ Kill Switch ACTIVATED. Reason: ${reason}`);
        } else {
          logError(`[WATCHDOG] Kill Switch API returned ${res.status}. Manual intervention needed!`);
        }
      } catch (e: any) {
        logError(`[WATCHDOG] Kill switch API failed: ${e.message}`);
      }
    } else {
      logWarn(`[WATCHDOG] [PAPER] Kill Switch simulated. Reason: ${reason}`);
    }

    asyncLog({ type: 'system_event', event: 'kill_switch_activated', reason });

    // Also liquidate any open positions
    await executeEmergencyMarketExit();

    // Start the HALT recovery watcher so the user can re-enable RUNNING without restarting the daemon
    this.startHaltRecoveryWatcher(token);
  }

  /**
   * 15:15 IST teardown: cancel all open GTTs then force-liquidate all positions.
   */
  private static async executeFlatBookTeardown(token: string): Promise<void> {
    this.botStatus = 'STOPPED';
    tracker.haltTrading('15:15 IST Hard Teardown');

    // Signal WS client to close cleanly (EventBus — no circular deps)
    eventBus.emit('system:shutdown');

    if (this.tradingMode === 'LIVE') {
      // Cancel active GTT if registered
      const gttId = tracker.getActiveGttId();
      if (gttId) {
        try {
          await fetch(`https://api.upstox.com/v3/order/gtt/${gttId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          });
          logInfo(`[WATCHDOG] GTT ${gttId} cancelled.`);
          tracker.clearActiveGtt();
        } catch (e: any) {
          logWarn(`[WATCHDOG] Failed to cancel GTT: ${e.message}`);
        }
      }

      // Force-exit all positions
      try {
        const exitRes = await fetch('https://api.upstox.com/v3/order/exit-all-positions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        });
        if (exitRes.ok) {
          logInfo('[WATCHDOG] ✅ All positions liquidated. Flat book confirmed.');
        } else {
          logWarn('[WATCHDOG] Exit-all-positions returned non-200. Falling back to native exit...');
          await executeEmergencyMarketExit();
        }
      } catch (e: any) {
        logError(`[WATCHDOG] Teardown exit failed: ${e.message}. Attempting native fallback...`);
        await executeEmergencyMarketExit();
      }
    } else {
      logInfo('[WATCHDOG] [PAPER] Teardown. Exiting simulated positions.');
      await executeEmergencyMarketExit();
    }

    asyncLog({ type: 'system_event', event: '1515_teardown_complete' });
    logInfo('[WATCHDOG] 15:15 Teardown complete. Bot is flat and halted.');
  }

  /**
   * HALT Recovery Watcher
   *
   * After an EMERGENCY_HALT, the daemon enters a monitor-only state.
   * This watcher polls Supabase every 60s to detect if the user has
   * manually re-enabled RUNNING from the dashboard.
   *
   * On detection:
   *   1. Resets the tracker's halt flag
   *   2. Restarts the lifecycle watchdog
   *   3. Stops this recovery watcher
   *
   * This allows recovery WITHOUT a full daemon restart.
   */
  private static startHaltRecoveryWatcher(token: string): void {
    if (this.haltRecoveryInterval) clearInterval(this.haltRecoveryInterval);

    logInfo('[HALT-RECOVERY] Watcher started. Polling every 60s for manual RUNNING re-enable...');

    this.haltRecoveryInterval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('system_state')
          .select('bot_status')
          .eq('id', 1)
          .single();

        if (error || !data) return;

        if (data.bot_status === 'RUNNING') {
          logInfo('[HALT-RECOVERY] ✅ User re-enabled RUNNING. Recovering from HALT...');
          clearInterval(this.haltRecoveryInterval!);
          this.haltRecoveryInterval = null;

          // Reset internal state
          this.botStatus = 'RUNNING';
          this.teardownFired = false;
          tracker.resetHalt();

          // Restart lifecycle watchdog
          this.startLifecycleWatchdog(token);

          logInfo('[HALT-RECOVERY] ✅ Daemon fully recovered. Confluence engine re-armed.');
          asyncLog({ type: 'system_event', event: 'halt_recovery_success' });
        }
      } catch (err: any) {
        logWarn(`[HALT-RECOVERY] Poll failed: ${err.message}`);
      }
    }, 60000); // check every 60 seconds
  }
}
