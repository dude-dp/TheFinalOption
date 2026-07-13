// local-daemon/src/ws-client.ts
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { CandleAggregator } from './aggregator';
import { TickArchiver } from './archiver';
import { tracker } from './tracker';
import { varianceEngine } from './variance.js';
import { executor } from './executor.js';

// Import local MACD if available or mock it for compilation
let calculateMACD: any = null;
try {
  calculateMACD = require('./lib/macd').getLatestMACDValues;
} catch (e) {
  calculateMACD = (candles: any[]) => { return { macdLine: [0, 0], histogram: [0, 0] }; };
}

// 1. Define Strict Types for Market Depth
export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface MarketDepth {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface TickData {
  instrumentToken: string;
  ltp: number;
  timestamp: number;
  depth: MarketDepth; // The new payload for the Liquidity Scanner
}

export class UpstoxWSClient {
  private ws: WebSocket | null = null;
  private aggregator = new CandleAggregator();
  private archiver = new TickArchiver();
  private token: string;
  private instrumentKey = 'NSE_INDEX|Nifty 50'; 
  private workerUrl = process.env.CLOUD_WORKER_URL || '';
  private pollSecret = process.env.POLL_SECRET || '';

  private latestDepth: MarketDepth = { bids: [], asks: [] };

  constructor(token: string) {
    this.token = token;
  }

  public subscribe(instrumentKey: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subPayload = {
      guid: `sub_${instrumentKey}`,
      method: "sub",
      data: { mode: "full", instrumentKeys: [instrumentKey] }
    };
    this.ws.send(Buffer.from(JSON.stringify(subPayload)));
  }

  public async connect(onSignal: (signalData: any) => void) {
    const authRes = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
      headers: { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/json' }
    });

    if (!authRes.ok) {
      throw new Error(`Upstox WS Auth HTTP ${authRes.status}: Token may be expired.`);
    }

    const authData: any = await authRes.json();
    
    if (!authData.data?.authorized_redirect_uri) {
      throw new Error(`WS Auth Failed — No redirect URI. Response: ${JSON.stringify(authData)}`);
    }

    const root = await protobuf.load("./src/MarketDataFeed.proto");
    const FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");

    this.ws = new WebSocket(authData.data.authorized_redirect_uri);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      console.log('🟢 Upstox Native WebSocket Connected');
      
      const subPayload = {
        guid: "nifty_tracker",
        method: "sub",
        data: { mode: "full", instrumentKeys: [this.instrumentKey] }
      };
      this.ws?.send(Buffer.from(JSON.stringify(subPayload)));
    });

    this.ws.on('message', (data: ArrayBuffer) => {
      try {
        const decoded = FeedResponse.decode(new Uint8Array(data)) as any;
        
        if (decoded.feeds && decoded.feeds[this.instrumentKey]) {
          const feed = decoded.feeds[this.instrumentKey];
          
          if (feed.fullFeed?.ff?.marketFF?.ltpc?.ltp) {
            // 2. Extract and structure the Order Book Depth
            const depth: MarketDepth = { bids: [], asks: [] };
            const rawQuotes = feed.fullFeed.ff.marketFF.marketLevel?.bidAskQuote;
            
            if (rawQuotes && Array.isArray(rawQuotes)) {
              rawQuotes.forEach((q: any) => {
                if (q.bp > 0) depth.bids.push({ price: q.bp, quantity: q.bq, orders: q.bno });
                if (q.ap > 0) depth.asks.push({ price: q.ap, quantity: q.aq, orders: q.ano });
              });
            }

            // 3. Assemble the enriched tick
            const tick: TickData = {
              instrumentToken: this.instrumentKey,
              ltp: feed.fullFeed.ff.marketFF.ltpc.ltp,
              timestamp: Date.now(),
              depth: depth
            };

            this.latestDepth = depth;

            // 1. Measure Kinetic Velocity
            const volatilityState = varianceEngine.evaluateVelocity(tick.timestamp);

            this.archiver.recordTick(tick);

            // 1. Process the standard candle close logic
            const closedCandles = this.aggregator.processTick(tick);

            // 2. 🚀 X-RAY EXTRACTION: Get live, unfinished delta and volume from the active candle
            const liveDelta = this.aggregator.getLiveDelta();
            const liveVolume = this.aggregator.getLiveVolume();

            // 3. Monitor active positions for institutional exhaustion on EVERY millisecond tick
            executor.monitorLiveOrderFlow(liveDelta, liveVolume, tick.ltp);

            // 4. Standard MACD signal generation fires only when a full 1-minute candle closes
            if (closedCandles) {
              this.evaluateAndPushSignal(closedCandles, onSignal);
            }
          }
        } else if (decoded.feeds && tracker.activePositionToken && decoded.feeds[tracker.activePositionToken]) {
          const feed = decoded.feeds[tracker.activePositionToken];
          if (feed.fullFeed?.ff?.marketFF?.ltpc?.ltp) {
            const ltp = feed.fullFeed.ff.marketFF.ltpc.ltp;
            tracker.updateUnrealizedPnLFromLtp(ltp);
            
            // Evaluate Circuit Breaker dynamically on every option tick
            const cbReason = tracker.evaluateCircuitBreaker();
            if (cbReason) {
              import('./executor.js').then(({ executeMarketExitAll, haltTradingSession }) => {
                 console.log(`\n🛡️ [CIRCUIT BREAKER] TRIGGERED: ${cbReason}`);
                 executeMarketExitAll(this.workerUrl, this.pollSecret);
                 haltTradingSession(this.workerUrl, this.pollSecret, cbReason);
                 tracker.clearActivePosition(); // Prevent multi-triggers
              });
            }
          }
        }
      } catch (err) {
        console.error("Protobuf Decode Error", err);
      }
    });

    this.ws.on('error', (err) => {
      console.error('🔴 [WS CLIENT ERROR] Connection blip caught:', (err as any).message || err);
      // Do NOT throw or re-emit — just log it. The 'close' handler below will reconnect.
    });

    this.ws.on('close', () => {
      console.log('🔴 WS Closed. Reconnecting in 5s...');
      setTimeout(() => this.connect(onSignal), 5000);
    });
  }

  private evaluateAndPushSignal(candles: any[], onSignal: (signalData: any) => void) {
    if (!calculateMACD) return;

    const macdResult = calculateMACD(candles.map(c => c.close));
    if (!macdResult) return;

    // Use macdLine if available (zero-crossover), otherwise fall back to histogram
    const line = macdResult.macdLine || macdResult.histogram;
    if (!line || line.length < 2) return;

    const currentMacd = line[line.length - 1];
    const prevMacd = line[line.length - 2];

    let signal = 'NONE';
    if (prevMacd < 0 && currentMacd > 0) signal = 'BUY_CE';
    if (prevMacd > 0 && currentMacd < 0) signal = 'BUY_PE';

    // The most recently closed candle where the crossover just occurred
    const crossoverCandle = candles[candles.length - 1];

    onSignal({
      signal,
      currentMacd,
      prevMacd,
      spotPrice: crossoverCandle.close,
      crossoverDelta: crossoverCandle.delta, // 🚀 Injecting the Institutional Delta
      depth: this.latestDepth,
      timestamp: new Date().toISOString()
    });
  }
}
