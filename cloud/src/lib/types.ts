// ============================================
// TheFinalOption — Shared TypeScript Types
// MTF Screener Serverless Edition
// ============================================

// --- Cloudflare Bindings ---

export interface Env {
  TRADING_KV: KVNamespace;
  TRADING_DB: D1Database;
  MTF_QUEUE: Queue<MTFQueueMessage>;

  // Supabase
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // Upstox OAuth
  UPSTOX_CLIENT_ID: string;
  UPSTOX_CLIENT_SECRET: string;
  UPSTOX_REDIRECT_URI: string;

  // Auth
  POLL_SECRET: string;

  // Alerting
  DISCORD_MTF_WEBHOOK: string;

  // AI Catalyst (Groq)
  GROQ_API_KEY?: string;

  // Deployment
  ENVIRONMENT: string;
}

// --- AI Catalyst Confluence Types ---

export interface NewsHeadlineItem {
  title: string;
  source: string;
  published: string;
  link?: string;
}

export interface AICatalystResult {
  catalyst: string;
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  catalystType: 'EARNINGS' | 'ORDER_WIN' | 'SECTOR_ROTATION' | 'REGULATORY' | 'TECHNICAL_COIL' | 'GENERAL';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  headlines: NewsHeadlineItem[];
  modelUsed: string;
}

// --- MTF Screener Queue Message ---

/**
 * Message shape pushed by the Producer (cron) into mtf-screener-queue.
 * Each message represents one stock to be evaluated by a Consumer worker.
 */
export interface MTFQueueMessage {
  token: string;       // Upstox instrument_key (e.g. "NSE_EQ|INE002A01018")
  symbol: string;      // Trading symbol (e.g. "RELIANCE")
  sector: string;      // Sector label
  margin: number;      // MTF margin multiplier
  accessToken: string; // Upstox Bearer token (embedded per-scan)
}

// --- MTF Screener Data ---

export interface MTFSetupData {
  instrument_token: string;
  tradingsymbol: string;
  sector: string;
  current_price: number;
  mtf_margin_multiplier: number;
  distance_from_vwap_pct: number;
  rsi_14: number;
  macd_value: number;
  macd_signal: string;
  adx_trend: number;
  rvol: number;
  atr_value: number;
  suggested_sl: number;
  conviction: 'HIGH' | 'NORMAL';
  ai_catalyst?: string;
  catalyst_sentiment?: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  updated_at: string;
}

export interface ScreenerSignalResult {
  signals: string[];
  macdValue: number;
  rsi: number;
  adx: number;
  atr: number;
  vwapDist: number;
  rvol: number;
  suggestedSL: number;
  price: number;
}

// --- Candle Shape (used by screener math libs) ---

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- KV Key Constants ---

export const KV_KEYS = {
  UPSTOX_ACCESS_TOKEN: 'upstox_access_token',
  UPSTOX_TOKEN_EXPIRY: 'upstox_token_expiry',
  DAILY_CANDLE_CACHE:  'candle_cache',
  // Legacy keys — used by dashboard/OAuth routes in api.ts
  BOT_STATE:           'bot_state',
  PENDING_ORDERS:      'pending_orders',
  BOT_CONFIG:          'bot_config',
} as const;

// --- Upstox API Response Types ---

export interface UpstoxCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

export interface UpstoxOptionChainEntry {
  instrumentKey: string;
  strikePrice: number;
  expiryDate: string;
  optionType: string;
  ltp: number;
  tradingSymbol: string;
  lotSize: number;
  openInterest: number;
  theta: number;
}

export interface UpstoxFundsResponse {
  availableMargin: number;
  usedMargin: number;
  totalBalance: number;
}

export interface UpstoxOrderResponse {
  orderId: string;
  status: string;
  tradedPrice: number;
  tradedQuantity: number;
  message: string;
}

// --- System Logs ---

export interface SystemLog {
  id?: number;
  timestamp?: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
}

// --- Legacy types retained for dashboard/OAuth routes ---

export type BotStatus = 'RUNNING' | 'STOPPED' | 'EMERGENCY_HALT' | 'SYSTEM_HALT' | 'ORPHANED';
export type OrderStatus = 'PENDING' | 'DISPATCHED' | 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED';
export type TransactionType = 'BUY' | 'SELL';
export type OptionType = 'CE' | 'PE';
export type SignalType = 'NONE' | 'BUY_CE' | 'BUY_PE';

export interface OrderPayload {
  orderId: string;
  correlationId: string;
  instrumentToken: string;
  tradingSymbol: string;
  optionType: OptionType;
  strikePrice: number;
  transactionType: TransactionType;
  quantity: number;
  lots: number;
  orderPrice: number;
  status: OrderStatus;
  createdAt: string;
  marketDepth?: string;
  timeline?: string;
}

export interface PollResponse {
  hasOrders: boolean;
  orders: OrderPayload[];
  accessToken: string | null;
  botStatus: BotStatus;
}

export interface ConfirmRequest {
  correlationId: string;
  upstoxOrderId: string;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED';
  executionPrice: number | null;
  filledQuantity: number | null;
  rejectionReason: string | null;
  marketDepth?: string;
  timeline?: string;
}

// Legacy queue message type (kept for any remaining references)
export interface OrderQueueMessage {
  type: 'ORDER_STATUS_CHECK' | 'POSITION_CLOSE' | 'DISPATCH_SLICED_ORDER' | 'DISPATCH_EMERGENCY_MARKET';
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface TelemetryEntry {
  id?: number;
  timestamp: string;
  niftySpot: number;
  atmStrike: number;
  macdLine: number;
  prevMacdLine: number;
  signalGenerated: SignalType;
  botStatus: string;
  logMessage: string | null;
}

export interface BotConfig {
  maxRiskPct: number;
  niftyLotSize: number;
  rolloverOnExpiry: boolean;
  defaultExpiry: string;
  maxStrikeLevels: number;
  strikeInterval: number;
  squareOffTime: string;
  paperMode: boolean;
  maxSlippagePct: number;
  gexAvoidanceEnabled: boolean;
  gexStrikeBuffer: number;
  adxFilterEnabled: boolean;
  adxThreshold: number;
  momentumDecayEnabled: boolean;
}

export interface BotState {
  status: BotStatus;
  tradingMode?: 'LIVE' | 'PAPER';
  lastUpdated: string;
  activePosition: ActivePosition | null;
  activeHedgePosition?: ActivePosition | null;
  lockTimestamp: number | null;
  lastMacdLine: number | null;
  // Legacy fields used by dashboard confirmation endpoint
  lastVoiceAlert?: string;
  lastVoiceAlertId?: string;
  lastProfitableTradeId?: string;
  lastProfitPct?: number;
  daemonMetrics?: {
    lastUpdated: number;
    uptime?: number;
    cpuUsage?: number;
    memUsage?: number;
    scanCount?: number;
    reqPerSecond?: number;
    reqPerMinute?: number;
  };
}

export interface ActivePosition {
  correlationId: string;
  optionType: 'CE' | 'PE';
  instrumentToken: string;
  tradingSymbol: string;
  strikePrice: number;
  entryPrice: number;
  quantity: number;
  lots: number;
  enteredAt: string;
  highestPrice?: number;
  scaleOutDone?: boolean;
  entryAtr?: number;
  isStraddleLeg?: boolean;
  manualHardSL?: number;
  manualTrailingSL?: number;
}
