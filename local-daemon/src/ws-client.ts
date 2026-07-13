// local-daemon/src/ws-client.ts
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { createClient } from '@supabase/supabase-js';

// 🟢 FIXED: Added exact .js extensions for ESM compatibility
import { CandleAggregator } from './aggregator.js';
import { TickArchiver } from './archiver.js';
import { tracker } from './tracker.js';
import { varianceEngine } from './variance.js';
import { executor } from './executor.js';
import { DataEngine } from './data-engine.js';
// 🟢 FIXED: Native ESM Import for MACD (No more require() crashes)
import { getLatestMACDValues } from './lib/macd.js';
// 🟢 FIXED: Import the native EC2 market exit capability
import { executeEmergencyMarketExit } from './executor.js';

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
            const depth: MarketDepth = { bids: [], asks: [] };
            const rawQuotes = feed.fullFeed.ff.marketFF.marketLevel?.bidAskQuote;
            
            if (rawQuotes && Array.isArray(rawQuotes)) {
              rawQuotes.forEach((q: any) => {
                if (q.bp > 0) depth.bids.push({ price: q.bp, quantity: q.bq, orders: q.bno });
                if (q.ap > 0) depth.asks.push({ price: q.ap, quantity: q.aq, orders: q.ano });
              });
            }

            const tick: TickData = {
              instrumentToken: this.instrumentKey,
              ltp: feed.fullFeed.ff.marketFF.ltpc.ltp,
              timestamp: Date.now(),
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

            if (closedCandles && closedCandles.length > 0) {
              const latestClosedCandle = closedCandles[closedCandles.length - 1];
              DataEngine.recordLiveCandle(latestClosedCandle);
              this.evaluateAndPushSignal(closedCandles, onSignal);
            }
          }
        } else if (decoded.feeds && tracker.activePositionToken && decoded.feeds[tracker.activePositionToken]) {
          const feed = decoded.feeds[tracker.activePositionToken];
          if (feed.fullFeed?.ff?.marketFF?.ltpc?.ltp) {
            const ltp = feed.fullFeed.ff.marketFF.ltpc.ltp;
            tracker.updateUnrealizedPnLFromLtp(ltp);
            
            // 🟢 FIXED: 100% Native Circuit Breaker Routing
            const cbReason = tracker.evaluateCircuitBreaker();
            if (cbReason && !tracker.getState().isHalted) {
               console.log(`\n🛡️ [CIRCUIT BREAKER] TRIGGERED: ${cbReason}`);
               
               // 1. Mark tracker as halted immediately to block incoming signals
               tracker.haltTrading(cbReason);
               
               // 2. Execute stealth market exit natively
               executeEmergencyMarketExit().then(async () => {
                 tracker.clearActivePosition();
                 
                 // 3. Dispatch the new status to the UI dashboard instantly
                 const supabase = createClient(
                   process.env.SUPABASE_URL || '', 
                   process.env.SUPABASE_SERVICE_ROLE_KEY || ''
                 );
                 await supabase.from('system_state').update({ bot_status: 'EMERGENCY_HALT' }).eq('id', 1);
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
    });

    this.ws.on('close', () => {
      console.log('🔴 WS Closed. Entering auto-reconnect sequence...');
      
      const attemptReconnect = async () => {
        try {
          await this.connect(onSignal);
        } catch (err: any) {
          console.error(`🔴 Reconnect failed: ${err.message}. Retrying in 15s...`);
          setTimeout(attemptReconnect, 15000); // Bulletproof infinite retry loop
        }
      };
      
      setTimeout(attemptReconnect, 5000);
    });
  }

  private evaluateAndPushSignal(candles: any[], onSignal: (signalData: any) => void) {
    // 🟢 FIXED: Utilizing direct module invocation
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
