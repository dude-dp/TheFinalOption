import { fetchWithRetry } from './lib/upstox-fetcher.js';
async function test() {
  const url = `https://api.upstox.com/v2/historical-candle/NSE_EQ%7CINE040A01034/15minute/2026-07-27/2026-07-20`;
  const res = await fetchWithRetry(url, { 'Accept': 'application/json' });
  console.log(res);
}
test();
