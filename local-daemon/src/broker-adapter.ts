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
  averagePrice: number;
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

  // --- ADD THESE INSIDE YOUR BrokerAdapter CLASS ---
  
  private marginCache: any = { available_margin: 0, used_margin: 0, payin: 0 };
  private marginLastFetched: number = 0;

  /**
   * Safe Margin Fetcher: Protects against Upstox 429 Rate Limits.
   * Serves from cache unless 60 seconds have passed or forceRefresh is true.
   */
  public async getFundsAndMargin(forceRefresh = false): Promise<any> {
    if (!this.apiToken) return this.marginCache;
    
    const now = Date.now();
    if (!forceRefresh && (now - this.marginLastFetched < 60000)) {
      return this.marginCache; // Serve from cache to protect API limits
    }

    try {
      const response = await fetch('https://api.upstox.com/v2/user/get-funds-and-margin?client_id=NSE', {
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${this.apiToken}` }
      });

      if (response.ok) {
        let json: any;
        const resText = await response.text();
        try {
          json = JSON.parse(resText);
        } catch (e) {
          logError(`[BROKER] Margin JSON parse error: ${resText.substring(0, 100)}`);
          return this.marginCache;
        }
        if (json.status === 'success' && json.data?.equity) {
          this.marginCache = json.data.equity;
          this.marginLastFetched = now;
        }
      } else if (response.status === 429) {
        logWarn('[BROKER] 429 Too Many Requests on margin. Serving cached data.');
      }
    } catch (error) {
      logError(`[BROKER] Margin fetch error: ${error}`);
    }
    return this.marginCache;
  }

  /**
   * Safe expiry calculator ported from old strike.ts logic.
   * Calculates the target Tuesday expiry and handles same-day rollover.
   */
  /**
   * Option Chain Resolver: Dynamically fetches nearest expiry and finds the exact ATM Token
   */
  public async getAtmOptionToken(strikePrice: number, optionType: 'CE' | 'PE'): Promise<string> {
    if (!this.apiToken) throw new Error('No Upstox token available for Option Chain fetch.');
    
    try {
      // 1. Fetch available contracts to get expiry dates
      const contractRes = await fetch('https://api.upstox.com/v2/option/contract?instrument_key=NSE_INDEX%7CNifty%2050', {
         headers: { 'Authorization': `Bearer ${this.apiToken}`, 'Accept': 'application/json' }
      });
      const contractText = await contractRes.text();
      let contractData = JSON.parse(contractText);
      
      if (!contractRes.ok || !contractData.data) {
         throw new Error(`Failed to fetch option contracts: ${contractText.substring(0, 200)}`);
      }
      
      // The option contracts API returns a list of contracts. We need to find the unique expiry dates, sort them, and pick the nearest one.
      const expiries = Array.from(new Set(contractData.data.map((c: any) => c.expiry))).sort();
      if (expiries.length === 0) throw new Error("No expiries found in option contracts");
      const currentExpiry = expiries[0];
      
      // 2. Fetch the full option chain for that specific expiry
      const chainRes = await fetch(`https://api.upstox.com/v2/option/chain?instrument_key=NSE_INDEX%7CNifty%2050&expiry_date=${currentExpiry}`, {
         headers: { 'Authorization': `Bearer ${this.apiToken}`, 'Accept': 'application/json' }
      });
      let chainData: any;
      const chainText = await chainRes.text();
      try {
        chainData = JSON.parse(chainText);
      } catch (e) {
        throw new Error(`Invalid JSON for option chain: ${chainText.substring(0, 100)}`);
      }

      if (!chainRes.ok || !chainData.data) {
         throw new Error(`Failed to fetch option chain: ${JSON.stringify(chainData)}`);
      }
      
      // 2. Extract the exact instrument key for our ATM strike
      const contract = chainData.data.find((c: any) => Number(c.strike_price) === Number(strikePrice));
      if (contract) {
         return optionType === 'CE' ? contract.call_options.instrument_key : contract.put_options.instrument_key;
      }
      
      const availableStrikes = chainData.data.map((c: any) => c.strike_price).slice(0, 10);
      throw new Error(`Strike ${strikePrice} not found in option chain for expiry current_week. First 10 available: ${availableStrikes.join(', ')}`);
    } catch (error) {
      logError(`[BROKER] Option Chain Resolution Error: ${error}`);
      throw error;
    }
  }

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

      // 🟢 NEW: Ensure local memory matches Upstox EXACTLY
      const activePos = positions.find(p => p.netQuantity !== 0);
      if (activePos) {
        tracker.setActivePosition(activePos.instrumentToken, activePos.netQuantity, activePos.averagePrice || 0);
      } else {
        tracker.clearActivePosition();
      }

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

      let json: any;
      const resText = await response.text();
      try {
        json = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Invalid JSON for short term positions: ${resText.substring(0, 100)}`);
      }
      
      if (!json.data) return [];

      return json.data.map((pos: any) => ({
        tradingSymbol: pos.tradingsymbol,
        instrumentToken: pos.instrument_token,
        netQuantity: parseInt(pos.quantity) || 0,
        realizedPnL: parseFloat(pos.realised) || 0,
        unrealizedPnL: parseFloat(pos.unrealised) || 0,
        averagePrice: parseFloat(pos.average_price || pos.buy_price) || 0, // 🟢 ADD THIS
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

      let result: any;
      const resText = await response.text();
      try {
        result = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Invalid JSON for order place: ${resText.substring(0, 100)}`);
      }

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
