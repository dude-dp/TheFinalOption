import { createClient } from '@supabase/supabase-js';
import { logInfo, logError } from './logger.js';
import { brokerAdapter } from './broker-adapter.js';
import { executor } from './executor.js';
import { executeEmergencyMarketExit } from './executor.js';
import { tracker } from './tracker.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

export class StateEngine {
  public static activeToken: string | null = null;
  public static botStatus: string = 'STOPPED';
  private static telemetryInterval: NodeJS.Timeout | null = null;

  public static async initialize(onTokenRefresh: (newToken: string) => void) {
    logInfo('[STATE-ENGINE] Booting up PostgreSQL Realtime synchronization...');

    const { data, error } = await supabase
      .from('system_state')
      .select('upstox_access_token, bot_status')
      .eq('id', 1)
      .single();

    if (error) {
      logError(`[STATE-ENGINE] Failed to read initial state: ${error.message}`);
    } else if (data) {
      this.activeToken = data.upstox_access_token;
      this.botStatus = data.bot_status;
      logInfo(`[STATE-ENGINE] Baseline Status: ${this.botStatus}`);
      
      if (this.activeToken) {
        onTokenRefresh(this.activeToken);
        this.startTelemetryReporting(this.activeToken);
      }
    }

    supabase.channel('system_state_channel')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'system_state' }, (payload) => {
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

  /**
   * 📡 BACKGROUND TELEMETRY LOOP: Offloads HTTP requests from Cloudflare to EC2
   */
  private static startTelemetryReporting(token: string) {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);

    logInfo('[STATE-ENGINE] Starting 2-second live dashboard telemetry sync...');

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
            optionType: tracker.activePositionToken.includes('CE') ? 'CE' : 'PE'
        } : null;

        await supabase.from('system_state').update({
            live_pnl: state.activeUnrealizedPnL, // Pushes live floating PnL
            active_position_ltp: 0, // (Handled internally by UnrealizedPnL)
            account_margin: marginData,
            active_position: activePos, // Populates the Dashboard Active Trades UI!
            daemon_last_heartbeat: new Date().toISOString()
        }).eq('id', 1);
      } catch (err: any) {
        logError(`[TELEMETRY] Broadcast failed: ${err.message}`);
      }
    }, 2000); 
  }
}
