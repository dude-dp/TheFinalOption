// ============================================
// IST Time Utilities
// Indian Standard Time = UTC + 5:30
// ============================================

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function getCurrentIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function getTodayDateStr(): string {
  const ist = getCurrentIST();
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getISTComponents() {
  const ist = getCurrentIST();
  return {
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    seconds: ist.getUTCSeconds(),
    dayOfWeek: ist.getUTCDay(),
  };
}

/** NSE hours: 9:15 AM – 3:30 PM IST, Mon–Fri */
export function isMarketOpen(): boolean {
  const { hours, minutes, dayOfWeek } = getISTComponents();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const t = hours * 60 + minutes;
  return t >= 555 && t < 930; // 9:15=555, 15:30=930
}

/** Check if auto square-off time reached (default 15:15 IST) */
export function isSquareOffTime(sqTime: string = '15:15'): boolean {
  const { hours, minutes, dayOfWeek } = getISTComponents();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const [h, m] = sqTime.split(':').map(Number);
  return hours * 60 + minutes >= h * 60 + m;
}

/** EOD AI summary window: 15:35–15:40 IST */
export function isEODSummaryTime(): boolean {
  const { hours, minutes, dayOfWeek } = getISTComponents();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const t = hours * 60 + minutes;
  return t >= 935 && t < 940;
}

/** Pre-market warmup: 8:45–9:14 IST */
export function isPreMarketWarmup(): boolean {
  const { hours, minutes, dayOfWeek } = getISTComponents();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const t = hours * 60 + minutes;
  return t >= 525 && t <= 554;
}

export function formatIST(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const h = String(ist.getUTCHours()).padStart(2, '0');
  const m = String(ist.getUTCMinutes()).padStart(2, '0');
  const s = String(ist.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s} IST`;
}

/** Generate unique correlation ID: TFO-YYYYMMDD-HHmmss-random */
export function generateCorrelationId(): string {
  const ist = getCurrentIST();
  const d = `${ist.getUTCFullYear()}${String(ist.getUTCMonth() + 1).padStart(2, '0')}${String(ist.getUTCDate()).padStart(2, '0')}`;
  const t = `${String(ist.getUTCHours()).padStart(2, '0')}${String(ist.getUTCMinutes()).padStart(2, '0')}${String(ist.getUTCSeconds()).padStart(2, '0')}`;
  return `TFO-${d}-${t}-${Math.random().toString(36).substring(2, 8)}`;
}

export function getISTTimeFloat(): number {
  const istTime = getCurrentIST();
  // Convert to a float for easy comparison (e.g., 13:30 becomes 13.5)
  return istTime.getUTCHours() + (istTime.getUTCMinutes() / 60);
}
