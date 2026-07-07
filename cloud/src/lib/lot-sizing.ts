// ============================================
// Dynamic Lot Sizing Calculator
// Risk-adjusted position sizing with floor
// ============================================

/**
 * Calculate the maximum number of lots the bot can trade
 * based on available margin, current premium, and risk parameters.
 * 
 * Formula:
 *   Lots = floor((C_alloc × R_pct / 100) / (P_premium × N_multiplier))
 * 
 * Where:
 *   C_alloc      = Available trading capital
 *   R_pct        = Max risk percentage (e.g., 20 for 20%)
 *   P_premium    = Current ask/LTP premium of the option
 *   N_multiplier = Contract lot size (e.g., 65 for NIFTY as of Jan 2026)
 * 
 * Safety: Returns 0 if any input is invalid or insufficient margin.
 * 
 * @param availableMargin - Capital available for trading (from Upstox funds API)
 * @param premium - Current premium price of the selected option contract
 * @param lotSize - Contract lot multiplier (65 for NIFTY, fetched dynamically)
 * @param maxRiskPct - Maximum percentage of capital to risk per trade
 * @returns Number of whole lots to trade (minimum 0)
 */
export function calculateLots(
  availableMargin: number,
  premium: number,
  lotSize: number,
  maxRiskPct: number
): number {
  // Guard: Invalid or zero inputs
  if (availableMargin <= 0 || premium <= 0 || lotSize <= 0 || maxRiskPct <= 0) {
    return 0;
  }

  // Guard: Risk percentage sanity check (cap at 100%)
  const clampedRisk = Math.min(maxRiskPct, 100);

  // Calculate allocable capital
  const allocatedCapital = availableMargin * (clampedRisk / 100);

  // Cost per lot = premium × lot_size
  const costPerLot = premium * lotSize;

  // Guard: Insufficient margin for even 1 lot
  if (allocatedCapital < costPerLot) {
    return 0;
  }

  // Floor to whole lots only
  return Math.floor(allocatedCapital / costPerLot);
}

/**
 * Calculate the total order quantity from lots.
 * 
 * @param lots - Number of lots to trade
 * @param lotSize - Contract lot multiplier
 * @returns Total quantity (lots × lotSize)
 */
export function lotsToQuantity(lots: number, lotSize: number): number {
  return lots * lotSize;
}

/**
 * Calculate the estimated cost of an order.
 * 
 * @param lots - Number of lots
 * @param premium - Premium per unit
 * @param lotSize - Units per lot
 * @returns Total estimated cost
 */
export function estimateOrderCost(
  lots: number,
  premium: number,
  lotSize: number
): number {
  return lots * premium * lotSize;
}
