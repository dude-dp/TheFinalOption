import { createClient } from '@supabase/supabase-js';
import { logInfo, logError } from './logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
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
  }

  /**
   * 📡 BACKGROUND TELEMETRY LOOP: Offloads HTTP requests from Cloudflare to EC2
   */
  private static startTelemetryReporting(token: string) {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);

    logInfo('[STATE-ENGINE] Starting 2-second live dashboard telemetry sync...');

    this.telemetryInterval = setInterval(async () => {
      try {
        // 1. Fetch current margin balances from Upstox natively
        const marginRes = await fetch('https://api.upstox.com/v2/user/get-funds-and-margin?client_id=NSE', {
          headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        let marginData = {};
        if (marginRes.ok) {
          const json = await marginRes.json() as any;
          if (json.status === 'success' && json.data) {
            marginData = json.data.equity || {};
          }
        }

        // 2. Extract live position tracker info from local memory
        // (Dynamically defaults to 0 if there are no active trades active)
        // Note: Replace global elements here with your exact tracker.ts imports if necessary
        const livePnL = (global as any).currentLivePnL || 0.00; 
        const activeLTP = (global as any).currentActiveLTP || 0.00;

        // 3. Write directly to Supabase
        await supabase
          .from('system_state')
          .update({
            live_pnl: livePnL,
            active_position_ltp: activeLTP,
            account_margin: marginData,
            daemon_last_heartbeat: new Date().toISOString()
          })
          .eq('id', 1);

      } catch (err: any) {
        logError(`[TELEMETRY] Failed broadcasting loop iteration: ${err.message}`);
      }
    }, 2000); // Executing every 2 seconds
  }
}
