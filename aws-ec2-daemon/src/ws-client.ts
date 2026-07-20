// local-daemon/src/ws-client.ts
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

import { CandleAggregator } from './aggregator.js';
import { TickArchiver } from './archiver.js';
import { tracker } from './tracker.js';
import { varianceEngine } from './variance.js';
import { executor } from './executor.js';
import { DataEngine } from './data-engine.js';
import { getLatestMACDValues } from './lib/macd.js';
import { executeEmergencyMarketExit } from './executor.js';
import { StateEngine } from './state-engine.js';
import { logInfo, logError } from './logger.js';
import { resolveNiftyFuturesKey } from './instrument-resolver.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  depth: MarketDepth; 
}

export class UpstoxWSClient {
  private ws: WebSocket | null = null;
  private aggregator = new CandleAggregator();
  private archiver = new TickArchiver();
  private token: string;
  // NSE_INDEX|Nifty 50 — used for accurate LTP / spot price
  private instrumentKey = 'NSE_INDEX|Nifty 50';
  // NSE_FO futures — resolved dynamically on boot for real volume + depth
  private futuresKey: string | null = null;

  private latestDepth: MarketDepth = { bids: [], asks: [] };
  // Live futures order book — injected into index ticks for real depth-based delta
  private latestFuturesDepth: MarketDepth = { bids: [], asks: [] };
  // Cumulative traded lots from futures feed — delta gives us per-tick volume
  private lastFuturesCumVolume: number = 0;
  private lastLogTime: number = 0;
  private msgCount: number = 0;


  constructor(token: string) {
    this.token = token;
  }


  public updateToken(newToken: string) {
    this.token = newToken;
    logInfo(`[WS-CLIENT] Internal token dynamically updated for next reconnect.`);
  }

  public subscribe(instrumentKey: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subPayload = {
      guid: `sub_${instrumentKey}`,
      method: "sub",
      data: { mode: "full", instrumentKeys: [instrumentKey] }
    };
    // Send as Binary Frame (Buffer) as required by Upstox V3 API
    this.ws.send(Buffer.from(JSON.stringify(subPayload)));
  }

  public async connect(onSignal: (signalData: any) => void) {
    // Resolve the live NIFTY front-month futures key BEFORE connecting
    this.futuresKey = await resolveNiftyFuturesKey();

    const authRes = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
      headers: { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/json' }
    });

    if (!authRes.ok) {
      throw new Error(`Upstox WS Auth HTTP ${authRes.status}: Token may be expired.`);
    }

    let authData: any;
    const authText = await authRes.text();
    try {
      authData = JSON.parse(authText);
    } catch (e) {
      throw new Error(`WS Auth Failed — Invalid JSON: ${authText.substring(0, 100)}`);
    }
    
    if (!authData.data?.authorized_redirect_uri) {
      throw new Error(`WS Auth Failed — No redirect URI. Response: ${authText}`);
    }

    const root = await protobuf.load(path.join(__dirname, "MarketDataFeed.proto"));
    const FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");

    this.ws = new WebSocket(authData.data.authorized_redirect_uri);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      console.log('🟢 Upstox Native WebSocket Connected');
      // Subscribe BOTH instruments in one payload — index for LTP, futures for volume
      const keysToSubscribe = [this.instrumentKey];
      if (this.futuresKey) keysToSubscribe.push(this.futuresKey);

      const subPayload = {
        guid: "nifty_dual_tracker",
        method: "sub",
        data: { mode: "full", instrumentKeys: keysToSubscribe }
      };
      logInfo(`[WS-CLIENT] Subscribing to: ${keysToSubscribe.join(' + ')}`);
      this.ws?.send(Buffer.from(JSON.stringify(subPayload)));
    });


    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        // Bulletproof conversion: Node.js ws delivers Buffer, not ArrayBuffer.
        // Buffer IS a Uint8Array subclass, so we can use it directly with protobuf.
        let buffer: Uint8Array;
        if (Buffer.isBuffer(data)) {
          buffer = data; // Buffer extends Uint8Array — use directly
        } else if (data instanceof ArrayBuffer) {
          buffer = new Uint8Array(data);
        } else {
          // data is Buffer[] (fragmented) — concatenate
          buffer = Buffer.concat(data as Buffer[]);
        }

        this.msgCount++;
        // if (this.msgCount <= 5 || this.msgCount % 100 === 0) {
        //   logInfo(`[WS MESSAGE #${this.msgCount}] Received packet: ${buffer.length} bytes (type: ${typeof data}, isBuffer: ${Buffer.isBuffer(data)})`);
        // }

        const decoded = FeedResponse.decode(buffer);
        
        // CRITICAL FIX: decoded.feeds is a protobuf Map, NOT a plain JS object.
        // Object.keys() and bracket-access DO NOT work on protobuf Maps.
        // We MUST use FeedResponse.toObject() to convert it to a plain JS object.
        const msg = FeedResponse.toObject(decoded, {
          defaults: true,
          longs: Number,
          enums: String,
          bytes: String
        }) as any;

        // Debug first 5 messages to verify feed structure
        if (this.msgCount <= 5) {
          const feedKeys = msg.feeds ? Object.keys(msg.feeds) : [];
          logInfo(`[WS DEBUG #${this.msgCount}] Feed keys: [${feedKeys.join(', ')}] | type: ${msg.type}`);
          if (feedKeys.length > 0) {
            logInfo(`[WS DEBUG #${this.msgCount}] First feed sample: ${JSON.stringify(msg.feeds[feedKeys[0]]).substring(0, 300)}`);
          }
        }
        
        // 1. Process Main NIFTY 50 Tracker Feed
        if (msg.feeds && msg.feeds[this.instrumentKey]) {
          const feed = msg.feeds[this.instrumentKey];
          
          // FullFeed object directly contains indexFF and marketFF.
          const ff = feed.fullFeed || feed.FullFeed || feed.ff || feed.FF;
          const ltp = ff?.indexFF?.ltpc?.ltp || ff?.marketFF?.ltpc?.ltp 
                   || ff?.IndexFF?.ltpc?.ltp || ff?.MarketFF?.ltpc?.ltp;
          
          if (ltp) {
            if (this.msgCount <= 5) {
              logInfo(`[WS DEBUG #${this.msgCount}] ✅ Extracted LTP: ${ltp}`);
            }
            
            // Only log heartbeat every 10 seconds
            const now = Date.now();
            if (now - this.lastLogTime > 10000) {
               console.log(`\n💓 [NIFTY 50 LIVE] LTP: ${ltp} | Time: ${new Date().toISOString()}`);
               this.lastLogTime = now;
            }

            const depth: MarketDepth = { bids: [], asks: [] };
            const rawQuotes = ff?.marketFF?.marketLevel?.bidAskQuote || ff?.MarketFF?.marketLevel?.bidAskQuote;
            if (rawQuotes && Array.isArray(rawQuotes)) {
              rawQuotes.forEach((q: any) => {
                const bp = q.bidP || q.bp;
                const bq = q.bidQ || q.bq;
                const ap = q.askP || q.ap;
                const aq = q.askQ || q.aq;
                if (bp > 0) depth.bids.push({ price: bp, quantity: Number(bq) || 0, orders: 0 });
                if (ap > 0) depth.asks.push({ price: ap, quantity: Number(aq) || 0, orders: 0 });
              });
            }

            const ltt = ff?.indexFF?.ltpc?.ltt || ff?.marketFF?.ltpc?.ltt;
            const tickTime = ltt ? Number(ltt) : (msg.currentTs ? Number(msg.currentTs) : Date.now());

            // ── Inject futures depth into the tick so the aggregator can classify
            // aggressive buys/sells against a real order book, not an empty index book.
            const enrichedTick: TickData = {
              instrumentToken: this.instrumentKey,
              ltp: ltp,
              timestamp: tickTime,
              depth: this.latestFuturesDepth.bids.length > 0
                ? this.latestFuturesDepth
                : depth  // fallback to index depth (usually empty) until futures feed arrives
            };

            this.latestDepth = enrichedTick.depth;
            tracker.setSpotPrice(enrichedTick.ltp);


            varianceEngine.evaluateVelocity(enrichedTick.timestamp);
            this.archiver.recordTick(enrichedTick);

            const closedCandles = this.aggregator.processTick(enrichedTick);

            const liveDelta = this.aggregator.getLiveDelta();
            const liveVolume = this.aggregator.getLiveVolume();

            executor.monitorLiveOrderFlow(liveDelta, liveVolume, enrichedTick.ltp);

            const liveCandle = this.aggregator.getCurrentCandle();
            const currentClosedCandles = this.aggregator.getClosedCandles();

            if (liveCandle) {
              // Calculate live MACD indicator for current minute candle
              const closes = currentClosedCandles.map(c => c.close);
              closes.push(enrichedTick.ltp); // Append the live ltp

              const macdResult = getLatestMACDValues(closes);
              const liveMacd = macdResult ? macdResult.current : 0;

              tracker.setLatestTick({
                timestamp: liveCandle.timestamp,
                open: liveCandle.open,
                high: liveCandle.high,
                low: liveCandle.low,
                ltp: enrichedTick.ltp,
                macd_line: liveMacd
              });
            }


            if (closedCandles && closedCandles.length > 0) {
              const latestClosedCandle = closedCandles[closedCandles.length - 1];
              DataEngine.recordLiveCandle(latestClosedCandle);
              this.evaluateAndPushSignal(closedCandles, onSignal);

              // ─── Confluence Signal Evaluation ─────────────────────────
              // Non-blocking: StateEngine.evaluateAndRoute returns a Promise
              // that we intentionally do NOT await here so the WS handler
              // returns in microseconds.
              const allCandles = this.aggregator.getClosedCandles();
              const token = this.token;
              if (StateEngine.activeToken) {
                StateEngine.evaluateAndRoute(
                  allCandles,
                  latestClosedCandle.close,
                  StateEngine.activeToken
                ).catch((err: Error) => logError(`[SIGNAL] Unhandled error in evaluateAndRoute: ${err.message}`));
              }
              // ──────────────────────────────────────────────────────────
            }
          } else if (this.msgCount <= 5) {
            logInfo(`[WS DEBUG #${this.msgCount}] ⚠️ Feed found for ${this.instrumentKey} but no LTP. Feed structure: ${JSON.stringify(feed).substring(0, 300)}`);
          }
        }

        // ── 2. NIFTY Futures Feed — Real Volume + Order Book ─────────────────────────
        // This feed runs in parallel with the index feed.
        // We DO NOT drive candle timestamps or LTP from here — that stays on the index.
        // We ONLY extract:
        //   a) The real bid/ask order book — stored in latestFuturesDepth
        //   b) LTQ (Last Traded Quantity in lots) — used by aggregator for real volume
        if (this.futuresKey && msg.feeds && msg.feeds[this.futuresKey]) {
          const futFeed = msg.feeds[this.futuresKey];
          const futFF = futFeed.fullFeed || futFeed.FullFeed || futFeed.ff || futFeed.FF;
          const futMarket = futFF?.marketFF || futFF?.MarketFF;

          if (futMarket) {
            // Extract real order book depth
            const rawQuotes = futMarket?.marketLevel?.bidAskQuote;
            if (rawQuotes && Array.isArray(rawQuotes) && rawQuotes.length > 0) {
              const newDepth: MarketDepth = { bids: [], asks: [] };
              rawQuotes.forEach((q: any) => {
                const bp = q.bidP || q.bp;
                const bq = q.bidQ || q.bq;
                const ap = q.askP || q.ap;
                const aq = q.askQ || q.aq;
                if (bp > 0) newDepth.bids.push({ price: bp, quantity: Number(bq) || 0, orders: 0 });
                if (ap > 0) newDepth.asks.push({ price: ap, quantity: Number(aq) || 0, orders: 0 });
              });
              // Atomically update so the next index tick picks up the fresh book
              this.latestFuturesDepth = newDepth;
            }

            // Extract cumulative traded volume (LTQ delta = lots traded in this tick)
            const cumVolume = futMarket?.eFeedDetails?.LTQ ||
                              futMarket?.efeedDetails?.ltq ||
                              futMarket?.ltq || 0;
            if (cumVolume > 0 && cumVolume !== this.lastFuturesCumVolume) {
              const ltqDelta = cumVolume - this.lastFuturesCumVolume;
              // Only inject if delta is positive (guards against end-of-day reset)
              if (ltqDelta > 0) {
                this.aggregator.injectFuturesVolume(ltqDelta);
              }
              this.lastFuturesCumVolume = cumVolume;
            }
          }
        }

        // ── 3. Active Option Position Feed (Trailing Stops / Circuit Breakers) ───
        else if (msg.feeds && tracker.activePositionToken && msg.feeds[tracker.activePositionToken]) {
          const feed = msg.feeds[tracker.activePositionToken];
          const ff = feed.fullFeed || feed.FullFeed || feed.ff || feed.FF;
          const ltp = ff?.indexFF?.ltpc?.ltp || ff?.marketFF?.ltpc?.ltp
                   || ff?.IndexFF?.ltpc?.ltp || ff?.MarketFF?.ltpc?.ltp;
          
          if (ltp) {
            tracker.updateUnrealizedPnLFromLtp(ltp);
            
            const cbReason = tracker.evaluateCircuitBreaker();
            if (cbReason && !tracker.getState().isHalted) {
               console.log(`\n🛡️ [CIRCUIT BREAKER] TRIGGERED: ${cbReason}`);
               tracker.haltTrading(cbReason);
               executeEmergencyMarketExit().then(async () => {
                 tracker.clearActivePosition();
                 const supabase = createClient(
                   process.env.SUPABASE_URL || '', 
                   process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
                 );
                 await supabase.from('system_state').update({ bot_status: 'EMERGENCY_HALT' }).eq('id', 1);
               });
            }
          }
        } else if (this.msgCount <= 10) {
          const feedKeys = msg.feeds ? Object.keys(msg.feeds) : [];
          logInfo(`[WS DEBUG #${this.msgCount}] No matching feed. Available keys: [${feedKeys.join(', ')}] | Looking for: ${this.instrumentKey}`);
        }
      } catch (err: any) {
        // Log every unique error, not just the first one
        logError(`[WS DECODE ERROR] ${err.message} (msg #${this.msgCount})`);
        if (this.msgCount <= 3) {
          logError(`[WS DECODE STACK] ${err.stack}`);
        }
      }
    });

    this.ws.on('error', (err) => {
      console.error('🔴 [WS CLIENT ERROR] Connection blip caught:', (err as any).message || err);
    });

    this.ws.on('close', () => {
      console.log('🔴 WS Closed. Entering auto-reconnect sequence...');
      const attemptReconnect = async () => {
        try {
          await this.connect(onSignal);
        } catch (err: any) {
          console.error(`🔴 Reconnect failed: ${err.message}. Retrying in 15s...`);
          setTimeout(attemptReconnect, 15000); 
        }
      };
      setTimeout(attemptReconnect, 5000);
    });
  }

  private evaluateAndPushSignal(candles: any[], onSignal: (signalData: any) => void) {
    const macdResult = getLatestMACDValues(candles.map(c => c.close));
    if (!macdResult) return;

    const line = macdResult.macdLine || macdResult.histogram;
    if (!line || line.length < 2) return;

    const currentMacd = line[line.length - 1];
    const prevMacd = line[line.length - 2];

    let signal = 'NONE';
    if (prevMacd < 0 && currentMacd > 0) signal = 'BUY_CE';
    if (prevMacd > 0 && currentMacd < 0) signal = 'BUY_PE';

    const crossoverCandle = candles[candles.length - 1];

    onSignal({
      signal,
      currentMacd,
      prevMacd,
      spotPrice: crossoverCandle.close,
      crossoverDelta: crossoverCandle.delta, 
      depth: this.latestDepth,
      timestamp: new Date().toISOString()
    });
  }
}
