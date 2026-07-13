// local-daemon/src/state-engine.ts
import { createClient } from '@supabase/supabase-js';
import { logInfo, logError } from './logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

export class StateEngine {
  public static activeToken: string | null = null;
  public static botStatus: string = 'STOPPED';

  public static async initialize(onTokenRefresh: (newToken: string) => void) {
    logInfo('[STATE-ENGINE] Booting up PostgreSQL Realtime synchronization...');

    // 1. Fetch the baseline state on startup
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
      }
    }

    // 2. Subscribe to instant websocket pushes from Supabase
    supabase.channel('system_state_channel')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'system_state' }, (payload) => {
        const newState = payload.new;

        // Listen for UI Play/Pause button clicks
        if (newState.bot_status && newState.bot_status !== this.botStatus) {
          logInfo(`[STATE-ENGINE] 🚦 Bot Status Switched: ${this.botStatus} ➔ ${newState.bot_status}`);
          this.botStatus = newState.bot_status;
        }

        // Listen for OAuth log-ins
        if (newState.upstox_access_token && newState.upstox_access_token !== this.activeToken) {
          logInfo(`[STATE-ENGINE] 🔑 New Upstox Token intercepted from Dashboard login.`);
          this.activeToken = newState.upstox_access_token;
          onTokenRefresh(newState.upstox_access_token);
        }
      })
      .subscribe((status) => {
        logInfo(`[STATE-ENGINE] Realtime Pipeline: ${status}`);
      });
  }
}
