async function test() {
  const url = `https://api.upstox.com/v2/historical-candle/NSE_EQ%7CINE040A01034/30minute/2026-07-27/2026-07-20`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  console.log('30minute status:', data.status, 'candles:', data.data?.candles?.length);

  const url15 = `https://api.upstox.com/v2/historical-candle/NSE_EQ%7CINE040A01034/15minute/2026-07-27/2026-07-20`;
  const res15 = await fetch(url15, { headers: { 'Accept': 'application/json' } });
  const data15 = await res15.json();
  console.log('15minute status:', data15.status, 'candles:', data15.data?.candles?.length);
}
test();
