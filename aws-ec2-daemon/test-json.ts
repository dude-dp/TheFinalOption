import zlib from 'zlib';

async function run() {
  const url = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz';
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(buffer, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
  });
  const text = decompressed.toString('utf-8');
  
  const data = JSON.parse(text);
  const instruments = Array.isArray(data) ? data : Object.values(data);
  
  // Use today's timestamp (midnight UTC) to compare against expiry
  const now = Date.now();
  
  const niftyFutures = instruments
    .filter((i: any) =>
      i.instrument_type === 'FUT' &&
      i.name === 'NIFTY' &&
      new Date(i.expiry).getTime() >= now
    )
    .sort((a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
    
  console.log("Found NIFTY FUT:", niftyFutures.slice(0, 3).map((i: any) => ({ name: i.name, key: i.instrument_key, expiry: new Date(i.expiry).toISOString(), type: i.instrument_type })));
}
run();
