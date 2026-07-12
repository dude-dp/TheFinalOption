// ============================================
// TheFinalOption — Shared TypeScript Types
// ============================================

// --- Cloudflare Bindings ---

export interface Env {
  TRADING_KV: KVNamespace;
  TRADING_DB: D1Database;
  ORDER_QUEUE: Queue<OrderQueueMessage>;
  AI: Ai;

  // Environment variables
  UPSTOX_CLIENT_ID: string;
  UPSTOX_CLIENT_SECRET: string;
  UPSTOX_REDIRECT_URI: string;
  POLL_SECRET: string;
  ENVIRONMENT: string;
  
  // Discord Alerting
  DISCORD_WEBHOOK_URL: string;
}

// --- Bot State ---

export type BotStatus = 'RUNNING' | 'STOPPED' | 'EMERGENCY_HALT' | 'SYSTEM_HALT' | 'ORPHANED';

export interface BotState {
  status: BotStatus;
  tradingMode?: 'LIVE' | 'PAPER';
  lastUpdated: string;
  activePosition: ActivePosition | null;
  activeHedgePosition?: ActivePosition | null;
  lockTimestamp: number | null;
  lastMacdLine: number | null;
  daemonMetrics?: {
    reqPerSecond: number;
    reqPerMinute: number;
    lastUpdated: number;
  };
  lastProfitableTradeId?: string;
  lastProfitPct?: number;
  lastVoiceAlert?: string;
  lastVoiceAlertId?: string;
  indicators?: {
    pcr?: number;
    macd?: number;
    macdSignal?: number;
    macdHist?: number;
    atr?: number;
    adx?: number;
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
  hasScaledOut?: boolean;
  scaleOutDone?: boolean;
  entryAtr?: number;
  isStraddleLeg?: boolean;
  
  // NEW: Manual Risk Overrides
  manualHardSL?: number;
  manualTrailingSL?: number;
}

// --- KV Key Constants ---

export const KV_KEYS = {
  BOT_STATE: 'bot_state',
  UPSTOX_ACCESS_TOKEN: 'upstox_access_token',
  UPSTOX_TOKEN_EXPIRY: 'upstox_token_expiry',
  PENDING_ORDERS: 'pending_orders',
  DAILY_CANDLE_CACHE: 'candle_cache',
  ACCOUNT_MARGIN: 'account_margin',
} as const;

// --- Order Types ---

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

// --- Queue Messages ---

export interface OrderQueueMessage {
  type: 'ORDER_STATUS_CHECK' | 'POSITION_CLOSE' | 'DISPATCH_SLICED_ORDER' | 'DISPATCH_EMERGENCY_MARKET';
  correlationId: string;
  payload: Record<string, unknown>;
}

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

// --- Telemetry ---

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

// --- Bot Configuration ---

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

// --- Dashboard Types ---

export interface DashboardData {
  botState: BotState;
  config: BotConfig;
  recentOrders: OrderPayload[];
  telemetry: TelemetryEntry[];
  dailySummary: {
    totalTrades: number;
    winningTrades: number;
    totalPnl: number;
    aiSummary: string | null;
  } | null;
  chartData: {
    spots: { timestamp: string; value: number }[];
    macd: { timestamp: string; value: number }[];
  };
}
