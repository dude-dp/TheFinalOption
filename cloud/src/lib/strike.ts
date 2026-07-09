// ============================================
// Strike Price Selection Engine
// ATM rounding, strike range, expiry rollover
// ============================================

import type { OptionType } from './types';

/**
 * Calculate the At-The-Money (ATM) strike price by rounding
 * the spot price to the nearest strike interval (default 50).
 * 
 * S_ATM = Round(P_spot / interval) × interval
 * 
 * Example: Spot = 24,673 → ATM = Round(24673/50) × 50 = 24,650
 *          Spot = 24,690 → ATM = Round(24690/50) × 50 = 24,700
 */
export function calculateATM(spotPrice: number, interval: number = 50): number {
  return Math.round(spotPrice / interval) * interval;
}

/**
 * Get the valid strike price range centered on ATM,
 * bounded by the maximum number of allowed levels.
 * 
 * Trading Range = [ATM - (levels × interval), ATM + (levels × interval)]
 * 
 * With default levels=2 and interval=50:
 * Range = [ATM - 100, ATM + 100]
 */
export function getStrikeRange(
  atm: number,
  levels: number = 2,
  interval: number = 50
): { lower: number; upper: number; strikes: number[] } {
  const lower = atm - levels * interval;
  const upper = atm + levels * interval;

  const strikes: number[] = [];
  for (let s = lower; s <= upper; s += interval) {
    strikes.push(s);
  }

  return { lower, upper, strikes };
}

/**
 * Select the optimal strike for an option trade.
 * 
 * For simplicity and reliability, the bot selects the ATM strike
 * for both CE and PE trades. This provides the best liquidity
 * and tightest spreads during momentum crossovers.
 * 
 * @param spotPrice - Current NIFTY spot price
 * @param optionType - CE or PE
 * @param interval - Strike interval (default 50)
 * @returns The selected strike price
 */
export function selectStrike(
  spotPrice: number,
  optionType: OptionType,
  interval: number = 50
): number {
  // ATM provides best liquidity for momentum entries
  return calculateATM(spotPrice, interval);
}

/**
 * Generate preferred strikes cascading from ATM to OTM.
 * Returns an array starting with ATM, followed by OTM levels 1 through 4.
 */
export function getPreferredStrikes(
  spotPrice: number,
  optionType: OptionType,
  interval: number = 50,
  maxOtmLevels: number = 4
): number[] {
  const atm = calculateATM(spotPrice, interval);
  const strikes = [atm];

  for (let i = 1; i <= maxOtmLevels; i++) {
    if (optionType === 'CE') {
      strikes.push(atm + (i * interval)); // Higher strikes are OTM for CE
    } else {
      strikes.push(atm - (i * interval)); // Lower strikes are OTM for PE
    }
  }
  return strikes;
}

/**
 * Determine whether the bot should roll to the next weekly expiry.
 * 
 * On expiry day (Tuesday), theta decay and gamma spikes make
 * current-week options extremely risky. The bot rolls to next week.
 * 
 * @param currentDate - Current date in IST
 * @param rolloverEnabled - Whether the rollover rule is active
 * @returns true if the bot should use next week's expiry
 */
export function shouldRollExpiry(
  currentDate: Date,
  rolloverEnabled: boolean
): boolean {
  if (!rolloverEnabled) return false;

  // Tuesday = day 2 in JavaScript Date
  const dayOfWeek = currentDate.getDay();
  return dayOfWeek === 2;
}

/**
 * Get the nearest weekly expiry date for NIFTY options.
 * NIFTY weekly options expire on Tuesday.
 * 
 * @param fromDate - Reference date
 * @param rollToNext - If true, skip the current week's expiry
 * @returns Expiry date string in YYYY-MM-DD format
 */
export function getNearestWeeklyExpiry(
  fromDate: Date,
  rollToNext: boolean = false
): string {
  const date = new Date(fromDate);
  const dayOfWeek = date.getDay(); // 0=Sun, 2=Tue

  // Calculate days until next Tuesday
  let daysUntilTuesday = (2 - dayOfWeek + 7) % 7;

  // If today IS Tuesday and we're not rolling, use today's expiry
  if (daysUntilTuesday === 0 && !rollToNext) {
    // Today is Tuesday — this is the expiry
  } else if (daysUntilTuesday === 0 && rollToNext) {
    // Today is Tuesday but we're rolling — jump to next Tuesday
    daysUntilTuesday = 7;
  } else if (rollToNext) {
    // Roll adds 7 days to skip current week's expiry
    daysUntilTuesday += 7;
  }

  date.setDate(date.getDate() + daysUntilTuesday);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Build the Upstox trading symbol string for a NIFTY option.
 * 
 * Format: NIFTY{DDMMMYYYY}{STRIKE}{CE|PE}
 * Example: NIFTY10JUL202524650CE
 * 
 * @param expiryDate - Expiry date string (YYYY-MM-DD)
 * @param strikePrice - Strike price
 * @param optionType - CE or PE
 */
export function buildTradingSymbol(
  expiryDate: string,
  strikePrice: number,
  optionType: OptionType
): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const [year, month, day] = expiryDate.split('-');
  const monthStr = months[parseInt(month, 10) - 1];
  const dayStr = day.padStart(2, '0');

  return `NIFTY${dayStr}${monthStr}${year}${strikePrice}${optionType}`;
}
