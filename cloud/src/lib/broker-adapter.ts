// ============================================
// Multi-Broker Adapter Interface
// Future-proofing for switching to Zerodha, AngelOne, Finvasia, etc.
// ============================================

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionChainEntry {
  strike: number;
  callToken: string;
  putToken: string;
}

export interface FundsResponse {
  availableMargin: number;
  usedMargin: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
}

export interface OrderParams {
  correlationId: string;
  instrumentToken: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

export interface OrderResult {
  orderId: string;
  status: string;
}

export interface OrderStatusResult {
  orderId: string;
  status: string;
  filledQuantity: number;
  averagePrice: number;
}

export interface TokenResult {
  accessToken: string;
}

export interface BrokerAdapter {
  // Market Data
  fetchCandles(symbol: string, interval: string, date: string): Promise<Candle[]>;
  getOptionChain(expiry: string): Promise<OptionChainEntry[]>;
  getLTP(instrumentKeys: string[]): Promise<Record<string, number>>;
  
  // Account
  getFundsAndMargin(): Promise<FundsResponse>;
  getPositions(): Promise<Position[]>;
  
  // Orders
  placeOrder(params: OrderParams): Promise<OrderResult>;
  getOrderStatus(orderId: string): Promise<OrderStatusResult>;
  
  // Auth
  getAuthorizationUrl(): string;
  exchangeCodeForToken(code: string): Promise<TokenResult>;
}
