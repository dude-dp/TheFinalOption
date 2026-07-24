// ============================================
// Live NIFTY 50 Option Chain Fetcher
// ============================================
// Polls Upstox Option Chain API every 30 seconds during market hours.
// Extracts: OI, OI Change (delta-safe), IV, Bid/Ask, Greeks, PCR, Max Pain
// Feeds enriched data into tracker for AI consumption.
// ============================================

import { logInfo, logWarn, logError } from './logger.js';
import { tracker } from './tracker.js';
import { isPreMarket } from './lib/market-gate.js';
import type { OptionChainSnapshot, NearbyStrike } from './tracker.js';

interface RawStrikeData {
  strike_price: number;
  call_options: {
    instrument_key: string;
    market_data: {
      ltp: number;
      volume: number;
      oi: number;
      bid_price: number;
      ask_price: number;
      prev_oi?: number;
    };
    option_greeks: {
      delta: number;
      theta: number;
      gamma: number;
      vega: number;
      iv: number;
    };
  };
  put_options: {
    instrument_key: string;
    market_data: {
      ltp: number;
      volume: number;
      oi: number;
      bid_price: number;
      ask_price: number;
      prev_oi?: number;
    };
    option_greeks: {
      delta: number;
      theta: number;
      gamma: number;
      vega: number;
      iv: number;
    };
  };
}

export class OptionChainFetcher {
  private static pollInterval: NodeJS.Timeout | null = null;
  private static apiToken: string = '';
  private static cachedExpiry: string | null = null;

  // Enhancement 1: Zero Delta on Restart
  // Store previous poll's OI to compute real change.
  // null = first boot, so OI change is forced to 0.
  private static previousCallOI: number | null = null;
  private static previousPutOI: number | null = null;

  /**
   * Starts the 30-second polling loop.
   * Called from index.ts after WS client connects.
   */
  public static start(token: string): void {
    this.apiToken = token;
    if (this.pollInterval) clearInterval(this.pollInterval);

    logInfo('[OI-FETCHER] Starting option chain poller (30s interval)...');

    // Fire immediately on boot, then every 30s
    this.fetchAndProcess().catch(e => logWarn(`[OI-FETCHER] Initial fetch failed: ${e.message}`));

    this.pollInterval = setInterval(async () => {
      // Gate: Only poll during market hours (09:15 - 15:30 IST)
      const now = new Date();
      const istMs = now.getTime() + (5.5 * 3600 * 1000);
      const ist = new Date(istMs);
      const h = ist.getUTCHours();
      const m = ist.getUTCMinutes();
      const timeInMinutes = h * 60 + m;

      // 09:15 IST = 555 min, 15:30 IST = 930 min
      if (timeInMinutes < 555 || timeInMinutes > 930) {
        return; // Outside market hours
      }

      await this.fetchAndProcess().catch(e =>
        logWarn(`[OI-FETCHER] Poll failed: ${e.message}`)
      );
    }, 30000);
  }

  /**
   * Updates the Upstox token (called when StateEngine receives a fresh token).
   */
  public static updateToken(token: string): void {
    this.apiToken = token;
  }

  /**
   * Stops the polling loop (called on 15:15 teardown).
   */
  public static stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logInfo('[OI-FETCHER] Polling stopped.');
  }

  // ============================================
  // Core Fetch & Process Pipeline
  // ============================================

  private static async fetchAndProcess(): Promise<void> {
    if (!this.apiToken) {
      logWarn('[OI-FETCHER] No API token available. Skipping poll.');
      return;
    }

    // Step 1: Resolve nearest expiry (cached for the day)
    const expiry = await this.resolveNearestExpiry();
    if (!expiry) return;

    // Step 2: Fetch the full option chain
    const url = `https://api.upstox.com/v2/option/chain?instrument_key=NSE_INDEX%7CNifty%2050&expiry_date=${expiry}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Option chain API HTTP ${res.status}`);
    }

    const json = await res.json() as any;
    if (json.status !== 'success' || !json.data || !Array.isArray(json.data)) {
      throw new Error(`Invalid option chain response: ${JSON.stringify(json).substring(0, 200)}`);
    }

    const allStrikes: RawStrikeData[] = json.data;
    if (allStrikes.length === 0) {
      throw new Error('Empty option chain data');
    }

    // Step 3: Determine ATM strike (nearest to spot, rounded to 50)
    const spotPrice = tracker.liveSpotPrice;
    if (spotPrice <= 0) {
      logWarn('[OI-FETCHER] Spot price is 0. Skipping OI processing until WS feed provides LTP.');
      return;
    }

    const atmStrike = Math.round(spotPrice / 50) * 50;

    // Step 4: Extract ATM ± 5 strikes (11 total, 500-point range)
    const STRIKE_RANGE = 5;
    const nearbyStrikes: NearbyStrike[] = [];
    let atmData: RawStrikeData | null = null;

    // Total OI accumulators for PCR (computed from nearby strikes)
    let totalCallOI = 0;
    let totalPutOI = 0;

    for (const strike of allStrikes) {
      const distance = Math.abs(strike.strike_price - atmStrike) / 50;
      if (distance <= STRIKE_RANGE) {
        const callOI = strike.call_options?.market_data?.oi ?? 0;
        const putOI = strike.put_options?.market_data?.oi ?? 0;
        const callIV = strike.call_options?.option_greeks?.iv ?? 0;
        const putIV = strike.put_options?.option_greeks?.iv ?? 0;

        nearbyStrikes.push({
          strike: strike.strike_price,
          callOI,
          putOI,
          callIV,
          putIV,
          callDelta: strike.call_options?.option_greeks?.delta ?? 0,
          putDelta: strike.put_options?.option_greeks?.delta ?? 0,
        });

        totalCallOI += callOI;
        totalPutOI += putOI;

        if (strike.strike_price === atmStrike) {
          atmData = strike;
        }
      }
    }

    // If exact ATM wasn't found, pick the closest available strike
    if (!atmData) {
      const sorted = allStrikes
        .slice()
        .sort((a, b) => Math.abs(a.strike_price - atmStrike) - Math.abs(b.strike_price - atmStrike));
      atmData = sorted[0];
      logWarn(`[OI-FETCHER] Exact ATM ${atmStrike} not found. Using closest: ${atmData.strike_price}`);
    }

    // Sort nearby strikes by strike price for consistent ordering
    nearbyStrikes.sort((a, b) => a.strike - b.strike);

    // Step 5: Calculate True Max Pain (from the FULL chain, not just nearby)
    const maxPainStrike = this.calculateMaxPain(allStrikes);

    // Step 6: Enhancement 1 — Zero Delta Protection
    let callOIChange = 0;
    let putOIChange = 0;

    if (this.previousCallOI !== null && this.previousPutOI !== null) {
      callOIChange = totalCallOI - this.previousCallOI;
      putOIChange = totalPutOI - this.previousPutOI;
    }
    // else: first boot — changes stay at 0 to prevent fake spikes

    this.previousCallOI = totalCallOI;
    this.previousPutOI = totalPutOI;

    // Step 7: Compute PCR
    const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

    // Step 8: Extract ATM Greeks (Enhancement 2)
    const atmCallGreeks = atmData.call_options?.option_greeks;
    const atmPutGreeks = atmData.put_options?.option_greeks;
    const atmCallMarket = atmData.call_options?.market_data;
    const atmPutMarket = atmData.put_options?.market_data;

    // Step 9: Build the snapshot
    const snapshot: OptionChainSnapshot = {
      timestamp: new Date().toISOString(),
      atmStrike: atmData.strike_price,
      callOI: totalCallOI,
      putOI: totalPutOI,
      callOIChange,
      putOIChange,
      callIV: atmCallGreeks?.iv ?? 0,
      putIV: atmPutGreeks?.iv ?? 0,
      callBid: atmCallMarket?.bid_price ?? 0,
      callAsk: atmCallMarket?.ask_price ?? 0,
      putBid: atmPutMarket?.bid_price ?? 0,
      putAsk: atmPutMarket?.ask_price ?? 0,
      pcr,
      maxPainStrike,
      // Enhancement 2: ATM Greeks
      atmCallDelta: atmCallGreeks?.delta ?? 0,
      atmCallTheta: atmCallGreeks?.theta ?? 0,
      atmPutDelta: atmPutGreeks?.delta ?? 0,
      atmPutTheta: atmPutGreeks?.theta ?? 0,
      atmCallGamma: atmCallGreeks?.gamma ?? 0,
      atmCallVega: atmCallGreeks?.vega ?? 0,
      nearbyStrikes
    };

    // Step 10: Push to tracker
    tracker.setOIData(snapshot);

    logInfo(
      `[OI-FETCHER] ✅ ATM: ${snapshot.atmStrike} | ` +
      `Call OI: ${totalCallOI.toLocaleString()} (Δ${callOIChange >= 0 ? '+' : ''}${callOIChange.toLocaleString()}) | ` +
      `Put OI: ${totalPutOI.toLocaleString()} (Δ${putOIChange >= 0 ? '+' : ''}${putOIChange.toLocaleString()}) | ` +
      `PCR: ${pcr.toFixed(2)} | MaxPain: ${maxPainStrike} | ` +
      `IV: ${snapshot.callIV.toFixed(1)}/${snapshot.putIV.toFixed(1)}`
    );
  }

  // ============================================
  // True Max Pain Calculation
  // ============================================
  // Iterates through every strike, assumes it as expiry price,
  // and sums up total intrinsic value (cash payout) owed to
  // option buyers. The strike with LOWEST total payout = Max Pain.
  // ============================================

  private static calculateMaxPain(allStrikes: RawStrikeData[]): number {
    if (allStrikes.length === 0) return 0;

    let minPain = Infinity;
    let maxPainStrike = 0;

    // Get all unique strike prices
    const strikePrices = allStrikes.map(s => s.strike_price);

    for (const hypotheticalExpiry of strikePrices) {
      let totalPayout = 0;

      for (const strike of allStrikes) {
        const callOI = strike.call_options?.market_data?.oi ?? 0;
        const putOI = strike.put_options?.market_data?.oi ?? 0;

        // Call buyers get paid if expiry > strike
        if (hypotheticalExpiry > strike.strike_price) {
          totalPayout += (hypotheticalExpiry - strike.strike_price) * callOI;
        }

        // Put buyers get paid if expiry < strike
        if (hypotheticalExpiry < strike.strike_price) {
          totalPayout += (strike.strike_price - hypotheticalExpiry) * putOI;
        }
      }

      if (totalPayout < minPain) {
        minPain = totalPayout;
        maxPainStrike = hypotheticalExpiry;
      }
    }

    return maxPainStrike;
  }

  // ============================================
  // Expiry Resolution (cached for the day)
  // ============================================

  private static async resolveNearestExpiry(): Promise<string | null> {
    if (this.cachedExpiry) return this.cachedExpiry;

    try {
      const res = await fetch(
        'https://api.upstox.com/v2/option/contract?instrument_key=NSE_INDEX%7CNifty%2050',
        { headers: { 'Authorization': `Bearer ${this.apiToken}`, 'Accept': 'application/json' } }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as any;
      if (!json.data || json.data.length === 0) throw new Error('No contracts found');

      const expiries = Array.from(
        new Set(json.data.map((c: any) => c.expiry))
      ).sort() as string[];

      if (expiries.length === 0) throw new Error('No expiries found');

      this.cachedExpiry = expiries[0]; // Nearest expiry
      logInfo(`[OI-FETCHER] Resolved nearest expiry: ${this.cachedExpiry}`);
      return this.cachedExpiry;
    } catch (err: any) {
      logError(`[OI-FETCHER] Failed to resolve expiry: ${err.message}`);
      return null;
    }
  }
}
