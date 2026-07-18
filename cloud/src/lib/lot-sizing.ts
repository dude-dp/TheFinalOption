// ============================================
// Dynamic Lot Sizing Calculator
// Risk-adjusted position sizing with floor
// ============================================

// ============================================
// 2026 Regulatory Friction Constants
// ============================================

/** NIFTY 50 contract lot size — confirmed 2026 standard */
export const NIFTY_LOT_SIZE_2026 = 65;

/** STT rate on sell-side option premium (2026 regulation: 0.15%) */
export const STT_SELL_RATE = 0.0015;

/** NSE exchange transaction charge rate */
export const EXCHANGE_TXN_RATE = 0.000053;

/** SEBI turnover levy rate */
export const SEBI_LEVY_RATE = 0.000001;

/**
 * Calculate the total structural friction cost on an option sell (exit) order.
 *
 * Covers: STT (0.15%) + NSE exchange transaction charge + SEBI levy.
 * Used to compute the gross premium movement needed to clear a net profit target.
 *
 * @param fillPrice - Actual average fill price of the option (₹ per unit)
 * @param lots      - Number of lots in the position
 * @param lotSize   - Units per lot (65 for NIFTY 2026)
 * @returns Total friction cost in ₹
 */
export function calculateFrictionCost(
  fillPrice: number,
  lots: number,
  lotSize: number = NIFTY_LOT_SIZE_2026
): number {
  const turnoverValue = fillPrice * lots * lotSize;
  const stt = turnoverValue * STT_SELL_RATE;
  const exchange = turnoverValue * EXCHANGE_TXN_RATE;
  const sebi = turnoverValue * SEBI_LEVY_RATE;
  return stt + exchange + sebi;
}

/**
 * Calculate the gross premium point movement required to achieve
 * a net monetary profit target after all friction costs.
 *
 * Formula: GrossPoints = (NetTarget + FrictionCost) / (Lots × LotSize)
 *
 * This is intentionally dynamic — as lot count grows, gross points required
 * per unit shrink (friction is spread across more units). As IV expands,
 * the fill price rises which also raises friction, so this recalculates fresh
 * on every trade.
 *
 * @param fillPrice       - Actual fill price of the entry order (₹ per unit)
 * @param lots            - Number of lots in the position
 * @param netProfitTarget - Required net profit in ₹ (e.g., 2% of daily capital)
 * @param lotSize         - Units per lot (65 for NIFTY 2026)
 * @returns Gross premium points needed above fill price to clear net target
 */
export function calculateGrossTargetPoints(
  fillPrice: number,
  lots: number,
  netProfitTarget: number,
  lotSize: number = NIFTY_LOT_SIZE_2026
): number {
  if (lots <= 0 || lotSize <= 0) return 0;
  const friction = calculateFrictionCost(fillPrice, lots, lotSize);
  return (netProfitTarget + friction) / (lots * lotSize);
}

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

  // Cost per lot = premium × lot_size + 2% safety buffer for charges & slippage
  const costPerLot = (premium * lotSize) * 1.02;

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
