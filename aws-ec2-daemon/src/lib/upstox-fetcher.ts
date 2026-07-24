import { logWarn, logError } from '../logger.js';

/**
 * Fetch a URL with:
 *  - 10-second hard timeout (AbortController)
 *  - 3 retries with exponential backoff
 *  - 429 rate-limit awareness
 */
export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxAttempts = 3
): Promise<any | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        const backoff = 1500 * attempt;
        logWarn(`[UPSTOX-FETCH] ⚠️ Rate limited (429). Backing off ${backoff}ms (attempt ${attempt}/${maxAttempts})...`);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        logWarn(`[UPSTOX-FETCH] HTTP ${res.status} on attempt ${attempt}/${maxAttempts}`);
        if (attempt < maxAttempts) { await sleep(1000 * attempt); continue; }
        return null;
      }

      return await res.json();

    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        logWarn(`[UPSTOX-FETCH] ⏱️ Timeout on attempt ${attempt}/${maxAttempts}. Retrying...`);
        await sleep(1000 * attempt);
        continue;
      }
      logError(`[UPSTOX-FETCH] Network error: ${err.message}`);
      if (attempt < maxAttempts) { await sleep(1000 * attempt); continue; }
      return null;
    }
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
