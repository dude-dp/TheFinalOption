// local-daemon/src/broker-adapter.ts

import { logInfo, logError } from './logger.js';

let accessToken = '';

export function setAccessToken(token: string) {
  accessToken = token;
}

export interface UpstoxPosition {
  tradingSymbol: string;
  instrumentToken: string;
  netQuantity: number;
  product: string;
}

export interface PlaceOrderParams {
  tradingSymbol: string;
  instrumentToken: string;
  transactionType: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  product: string;
  isEmergency?: boolean;
}

export const brokerAdapter = {
  getOpenPositions: async (): Promise<UpstoxPosition[]> => {
    if (!accessToken) {
      throw new Error('Access token not set in broker-adapter');
    }
    
    try {
      const res = await fetch('https://api.upstox.com/v2/portfolio/short-term-positions', {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!res.ok) {
        throw new Error(`Upstox HTTP error fetching positions: ${res.status}`);
      }
      
      const data: any = await res.json();
      const rawPositions = data?.data || [];
      
      // Map to the structure expected by executeEmergencyMarketExit
      return rawPositions.map((pos: any) => ({
        tradingSymbol: pos.tradingsymbol,
        instrumentToken: pos.instrument_token,
        netQuantity: parseInt(pos.quantity),
        product: pos.product
      })).filter((pos: any) => pos.netQuantity !== 0); // only active open positions
    } catch (err: any) {
      logError(`[BROKER ADAPTER] Failed to fetch positions: ${err.message}`);
      throw err;
    }
  },
  
  placeOrder: async (params: PlaceOrderParams): Promise<any> => {
    if (!accessToken) {
      throw new Error('Access token not set in broker-adapter');
    }
    
    try {
      const body = {
        instrument_token: params.instrumentToken,
        transaction_type: params.transactionType,
        quantity: params.quantity,
        product: params.product || 'I',
        validity: 'DAY',
        order_type: params.orderType || 'MARKET',
        price: 0,
        trigger_price: 0,
        disclosed_quantity: 0,
        is_amo: false
      };
      
      const res = await fetch('https://api.upstox.com/v2/order/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(body)
      });
      
      const data: any = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(`Upstox placeOrder failed: ${JSON.stringify(data.errors || data)}`);
      }
      
      logInfo(`[BROKER ADAPTER] Direct order placed successfully. Upstox ID: ${data?.data?.order_id}`);
      return data;
    } catch (err: any) {
      logError(`[BROKER ADAPTER] Direct order placement failed: ${err.message}`);
      throw err;
    }
  }
};
