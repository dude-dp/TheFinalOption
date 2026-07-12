// local-daemon/src/broker-adapter.ts

import { tracker } from './tracker.js';
import { logInfo, logWarn, logError } from './logger.js';

export interface OrderParams {
  tradingSymbol: string;
  instrumentToken: string;
  transactionType: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  product: string;
  isEmergency?: boolean;
}

export interface UpstoxPosition {
  tradingSymbol: string;
  instrumentToken: string;
  netQuantity: number;
  realizedPnL: number;
  unrealizedPnL: number;
  product: string;
}

class BrokerAdapter {
  private apiToken: string = '';
  private syncInterval: NodeJS.Timeout | null = null;

  // Semaphore to prevent overlapping network requests if the API lags
  private isSyncing: boolean = false;

  // Auth failure backoff — pause the thread on repeated 401s
  private consecutiveAuthFailures: number = 0;
  private readonly AUTH_FAILURE_PAUSE_THRESHOLD = 2; // pause after 2 consecutive 401s
  private syncPaused: boolean = false;

  /**
   * Initializes the adapter with the active Upstox access token
   * and boots up the self-healing background thread.
   * Calling this with a fresh token also resumes a paused sync thread.
   */
  public initialize(token: string): void {
    this.apiToken = token;
    // Reset auth failure state so the thread resumes with the fresh token
    this.consecutiveAuthFailures = 0;
    if (this.syncPaused) {
      this.syncPaused = false;
      logInfo('[BROKER] 🔄 Fresh token received. Resuming reconciliation thread.');
    }
    this.startReconciliationThread();
    logInfo('[BROKER] Adapter initialized. Connection to exchange secured.');
  }

  /**
   * 🔄 The Self-Healing Heartbeat
   * Runs exactly every 3 seconds on a separate event loop phase.
   * Pauses automatically on repeated 401s to prevent log spam.
   */
  private startReconciliationThread(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (!this.syncPaused) this.reconcileState();
    }, 3000);

    logInfo('[BROKER] 🛡️ Background State Reconciliation Thread started (3s heartbeat).');
  }

  /**
   * Fetches absolute truth from the exchange and forcefully overrides local memory.
   */
  private async reconcileState(): Promise<void> {
    if (this.isSyncing) return; // Prevent network pile-up if Upstox takes > 3s to respond
    this.isSyncing = true;

    try {
      const positions = await this.getOpenPositions();
      
      let totalRealized = 0;
      let totalUnrealized = 0;
      let openLotsCount = 0;

      for (const pos of positions) {
        // Upstox API native response variables mapped to our schema
        totalRealized += pos.realizedPnL;
        totalUnrealized += pos.unrealizedPnL;
        
        if (pos.netQuantity !== 0) {
          openLotsCount++;
        }
      }

      // 1. Force state synchronization on the tracker
      tracker.setRealizedPnL(totalRealized);
      tracker.updateUnrealizedPnL(totalUnrealized);

      // 2. Logging deep reconciliation events (Only log if things change to prevent spam)
      // logInfo(`[BROKER-SYNC] State Reconciled. Realized: ₹${totalRealized}, Unrealized: ₹${totalUnrealized}`);

      // Reset failure counter on success
      this.consecutiveAuthFailures = 0;

    } catch (error) {
      this.consecutiveAuthFailures++;
      const isAuthError = String(error).includes('401') || String(error).includes('403');

      if (isAuthError && this.consecutiveAuthFailures >= this.AUTH_FAILURE_PAUSE_THRESHOLD) {
        if (!this.syncPaused) {
          this.syncPaused = true;
          logWarn(`[BROKER-SYNC] ⏸️  Token appears expired (${this.consecutiveAuthFailures} consecutive 401s). Pausing reconciliation thread. Will auto-resume when a fresh token is loaded.`);
        }
        // Silently skip — no more spam until initialize() is called with a fresh token
      } else {
        // Transient network error — log once and continue
        logWarn(`[BROKER-SYNC] API connection stutter. Skipping this heartbeat cycle. Error: ${error}`);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Retrieves the current positions from the Upstox API.
   */
  public async getOpenPositions(): Promise<UpstoxPosition[]> {
    if (!this.apiToken) return [];

    try {
      const response = await fetch('https://api.upstox.com/v2/portfolio/short-term-positions', {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Upstox API HTTP ${response.status}`);
      }

      const json = await response.json() as any;
      
      if (!json.data) return [];

      return json.data.map((pos: any) => ({
        tradingSymbol: pos.tradingsymbol,
        instrumentToken: pos.instrument_token,
        netQuantity: parseInt(pos.quantity) || 0,
        realizedPnL: parseFloat(pos.realised) || 0,
        unrealizedPnL: parseFloat(pos.unrealised) || 0,
        product: pos.product
      }));

    } catch (error) {
      logError(`[BROKER] Failed to fetch open positions: ${error}`);
      throw error; // Let the reconciliation thread catch this
    }
  }

  /**
   * Places an order directly to the Upstox terminal.
   * Utilized by the Iceberg and Emergency Exit systems.
   */
  public async placeOrder(params: OrderParams): Promise<any> {
    logInfo(`[BROKER] Transmitting ${params.orderType} ${params.transactionType} for ${params.quantity} qty of ${params.tradingSymbol}`);

    try {
      const response = await fetch('https://api.upstox.com/v2/order/place', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          quantity: params.quantity,
          product: params.product || 'D', // 'D' for intraday standard 
          validity: 'DAY',
          price: params.orderType === 'LIMIT' ? 0 /* calculate limit */ : 0, // 0 for market
          tag: params.isEmergency ? 'EMERGENCY_EXIT' : 'AUTO_EXEC',
          instrument_token: params.instrumentToken,
          order_type: params.orderType,
          transaction_type: params.transactionType,
          disclosed_quantity: 0,
          trigger_price: 0,
          is_amo: false
        })
      });

      const result = await response.json() as any;

      if (!response.ok) {
        throw new Error(`Execution Failed: ${result.errors?.[0]?.message || 'Unknown Broker Error'}`);
      }

      return result.data;
    } catch (error) {
      logError(`[BROKER] Critical Order Placement Failure for ${params.tradingSymbol}: ${error}`);
      throw error;
    }
  }
}

// Export as singleton to maintain the background thread continuously
export const brokerAdapter = new BrokerAdapter();
