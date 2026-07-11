// local-daemon/src/ws-client.ts
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { CandleAggregator } from './aggregator';

// Import local MACD if available or mock it for compilation
// Assuming macd is moved to a local lib/macd.ts
let calculateMACD: any = null;
try {
  calculateMACD = require('./lib/macd').getLatestMACDValues;
} catch (e) {
  calculateMACD = (candles: any[]) => { return { histogram: [0, 0] }; };
}

export class UpstoxWSClient {
  private ws: WebSocket | null = null;
  private aggregator = new CandleAggregator();
  private token: string;
  private instrumentKey = 'NSE_INDEX|Nifty 50'; // Spot Index

  constructor(token: string) {
    this.token = token;
  }

  public async connect(onSignal: (signalData: any) => void) {
    // 1. Get the authorized WS URL from Upstox
    const authRes = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
      headers: { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/json' }
    });

    if (!authRes.ok) {
      throw new Error(`Upstox WS Auth HTTP ${authRes.status}: Token may be expired. Re-authenticate via the dashboard /api/auth/login`);
    }

    const authData: any = await authRes.json();
    
    if (!authData.data?.authorized_redirect_uri) {
      throw new Error(`WS Auth Failed — Upstox returned no redirect URI. Response: ${JSON.stringify(authData)}`);
    }

    // 2. Load the Protobuf schema
    const root = await protobuf.load("./src/MarketDataFeed.proto");
    const FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");

    // 3. Connect to the stream
    this.ws = new WebSocket(authData.data.authorized_redirect_uri);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      console.log('🟢 Upstox Native WebSocket Connected');
      
      // Subscribe to NIFTY 50
      const subPayload = {
        guid: "nifty_tracker",
        method: "sub",
        data: { mode: "full", instrumentKeys: [this.instrumentKey] }
      };
      this.ws?.send(Buffer.from(JSON.stringify(subPayload)));
    });

    this.ws.on('message', (data: ArrayBuffer) => {
      try {
        // Decode binary Protobuf
        const decoded = FeedResponse.decode(new Uint8Array(data)) as any;
        
        if (decoded.feeds && decoded.feeds[this.instrumentKey]) {
          const feed = decoded.feeds[this.instrumentKey];
          if (feed.fullFeed?.ff?.marketFF?.ltpc?.ltp) {
            
            const tick = {
              instrumentToken: this.instrumentKey,
              ltp: feed.fullFeed.ff.marketFF.ltpc.ltp,
              timestamp: Date.now() // Upstox feed also contains exchange timestamp
            };

            // Pass to aggregator
            const closedCandles = this.aggregator.processTick(tick);
            
            // If a candle just closed, run the math and fire the signal
            if (closedCandles) {
              this.evaluateAndPushSignal(closedCandles, onSignal);
            }
          }
        }
      } catch (err) {
        console.error("Protobuf Decode Error", err);
      }
    });

    this.ws.on('close', () => {
      console.log('🔴 WS Closed. Reconnecting in 5s...');
      setTimeout(() => this.connect(onSignal), 5000);
    });
  }

  private evaluateAndPushSignal(candles: any[], onSignal: (signalData: any) => void) {
    if (!calculateMACD) return;

    // Run MACD locally
    const macdResult = calculateMACD(candles.map(c => c.close));
    if (!macdResult || !macdResult.histogram) return;

    const hist = macdResult.histogram;
    if (hist.length < 2) return;

    const currentMacd = hist[hist.length - 1];
    const prevMacd = hist[hist.length - 2];

    let signal = 'NONE';
    if (prevMacd < 0 && currentMacd > 0) signal = 'BUY_CE';
    if (prevMacd > 0 && currentMacd < 0) signal = 'BUY_PE';

    const latestClose = candles[candles.length - 1].close;

    // Transmit to the callback (which pushes to Cloudflare)
    onSignal({
      signal,
      currentMacd,
      prevMacd,
      spotPrice: latestClose,
      timestamp: new Date().toISOString()
    });
  }
}
