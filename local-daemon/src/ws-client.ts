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
import { logInfo, logError } from './logger.js'; // 🟢 Added Logger

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
  private instrumentKey = 'NSE_INDEX|Nifty 50'; 

  private latestDepth: MarketDepth = { bids: [], asks: [] };
  private lastLogTime: number = 0;
  private decodeErrorLogged: boolean = false;

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
    // Send as Text Frame (plain string) as required by Upstox V3 API
    this.ws.send(JSON.stringify(subPayload));
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

    const root = await protobuf.load(path.join(__dirname, "MarketDataFeed.proto"));
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
      // Send as Text Frame (plain string) as required by Upstox V3 API
      this.ws?.send(JSON.stringify(subPayload));
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        // Bulletproof buffer conversion for Node.js
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        const decoded = FeedResponse.decode(buffer) as any;
        
        // 1. Process Main NIFTY 50 Tracker Feed
        if (decoded.feeds && decoded.feeds[this.instrumentKey]) {
          const feed = decoded.feeds[this.instrumentKey];
          const ff = feed.fullFeed?.ff;
          
          const ltp = ff?.indexFF?.ltpc?.ltp || ff?.marketFF?.ltpc?.ltp;
          
          if (ltp) {
            // 🟢 NEW: Visual Heartbeat for PM2 Logs (Fires once every 10 seconds)
            const now = Date.now();
            if (now - this.lastLogTime > 10000) {
                logInfo(`📡 [LIVE FEED] NIFTY 50 Active | Spot LTP: ₹${ltp.toFixed(2)}`);
                this.lastLogTime = now;
            }

            const depth: MarketDepth = { bids: [], asks: [] };
            const rawQuotes = ff?.marketFF?.marketLevel?.bidAskQuote;
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
            const tickTime = ltt ? Number(ltt) : (decoded.currentTs ? Number(decoded.currentTs) : Date.now());

            const tick: TickData = {
              instrumentToken: this.instrumentKey,
              ltp: ltp,
              timestamp: tickTime,
              depth: depth
            };

            this.latestDepth = depth;
            tracker.setSpotPrice(tick.ltp); 

            varianceEngine.evaluateVelocity(tick.timestamp);
            this.archiver.recordTick(tick);

            const closedCandles = this.aggregator.processTick(tick);
            const liveDelta = this.aggregator.getLiveDelta();
            const liveVolume = this.aggregator.getLiveVolume();

            executor.monitorLiveOrderFlow(liveDelta, liveVolume, tick.ltp);

            const liveCandle = this.aggregator.getCurrentCandle();
            const currentClosedCandles = this.aggregator.getClosedCandles();

            if (liveCandle) {
              // Calculate live MACD indicator for current minute candle
              const closes = currentClosedCandles.map(c => c.close);
              closes.push(tick.ltp); // Append the live ltp
              const macdResult = getLatestMACDValues(closes);
              const liveMacd = macdResult ? macdResult.current : 0;

              tracker.setLatestTick({
                timestamp: liveCandle.timestamp,
                open: liveCandle.open,
                high: liveCandle.high,
                low: liveCandle.low,
                ltp: tick.ltp,
                macd_line: liveMacd
              });
            }

            if (closedCandles && closedCandles.length > 0) {
              const latestClosedCandle = closedCandles[closedCandles.length - 1];
              DataEngine.recordLiveCandle(latestClosedCandle);
              this.evaluateAndPushSignal(closedCandles, onSignal);
            }
          }
        } 
        // 2. Process Active Option Trade Feed (Trailing Stops / Circuit Breakers)
        else if (decoded.feeds && tracker.activePositionToken && decoded.feeds[tracker.activePositionToken]) {
          const feed = decoded.feeds[tracker.activePositionToken];
          const ff = feed.fullFeed?.ff;
          const ltp = ff?.indexFF?.ltpc?.ltp || ff?.marketFF?.ltpc?.ltp;
          
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
        }
      } catch (err: any) {
        if (!this.decodeErrorLogged) {
            logError(`[WS DECODE ERROR] Protobuf parse failure (suppressing future errors): ${err.message}`);
            this.decodeErrorLogged = true;
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
