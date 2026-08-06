// ============================================
// TheFinalOption — Shared TypeScript Types
// MTF Screener Serverless Edition
// ============================================

// --- Cloudflare Bindings ---

export interface Env {
  TRADING_KV: KVNamespace;
  TRADING_DB: D1Database;
  MTF_QUEUE?: Queue<MTFQueueMessage>;

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

export interface MTFQueueItem {
  token: string;
  symbol: string;
  sector: string;
  margin: number;
}

export interface MTFQueueMessage {
  token?: string;       // Upstox instrument_key (e.g. "NSE_EQ|INE002A01018")
  symbol?: string;      // Trading symbol (e.g. "RELIANCE")
  sector?: string;      // Sector label
  margin?: number;      // MTF margin multiplier
  accessToken: string; // Upstox Bearer token (embedded per-scan)
  items?: MTFQueueItem[]; // Grouped items to reduce Cloudflare Queue write operations
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
} as const;

// --- Upstox API Response Types ---

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
