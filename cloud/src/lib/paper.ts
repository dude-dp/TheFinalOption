import type { Env, BotState, OrderPayload } from './types';
import { KV_KEYS } from './types';

export async function executePaperTrade(env: Env, order: OrderPayload, currentLtp: number) {
  // Simulate 0 slippage fill at the exact trigger price
  const executionPrice = currentLtp;
  let pnlToUpdate = 0;
  
  // Calculate PnL if it's an exit order
  if (order.transactionType === 'SELL') {
     const buyOrder = await env.TRADING_DB.prepare(
       `SELECT execution_price FROM paper_ledger 
        WHERE trading_symbol = ? AND transaction_type = 'BUY' AND order_status = 'FILLED' 
        ORDER BY created_at DESC LIMIT 1`
     ).bind(order.tradingSymbol).first();
     
     if (buyOrder && buyOrder.execution_price) {
        pnlToUpdate = (executionPrice - (buyOrder.execution_price as number)) * order.quantity;
     }
  }
  
  // Save to the isolated Paper Ledger
  await env.TRADING_DB.prepare(
    `INSERT INTO paper_ledger (order_id, correlation_id, instrument_token, trading_symbol, option_type, strike_price, transaction_type, quantity, lots, order_price, execution_price, order_status, pnl)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    order.orderId, order.correlationId, order.instrumentToken, order.tradingSymbol, 
    order.optionType, order.strikePrice, order.transactionType, order.quantity, 
    order.lots, order.orderPrice, executionPrice, 'FILLED', pnlToUpdate
  ).run();
  
  // Seamlessly update the Bot State so the Dashboard UI tracks the fake trade
  const stateRaw = await env.TRADING_KV.get(KV_KEYS.BOT_STATE);
  if (stateRaw) {
     const state: BotState = JSON.parse(stateRaw);
     
     if (order.transactionType === 'SELL') {
        if (state.activePosition?.tradingSymbol === order.tradingSymbol) state.activePosition = null;
        if (state.activeHedgePosition?.tradingSymbol === order.tradingSymbol) state.activeHedgePosition = null;
     } else if (order.transactionType === 'BUY') {
        state.activePosition = {
           correlationId: order.correlationId,
           optionType: order.optionType as 'CE'|'PE',
           instrumentToken: order.instrumentToken,
           tradingSymbol: order.tradingSymbol,
           strikePrice: order.strikePrice,
           entryPrice: executionPrice,
           quantity: order.quantity,
           lots: order.lots,
           enteredAt: new Date().toISOString()
        };
     }
     state.lockTimestamp = null;
     await env.TRADING_KV.put(KV_KEYS.BOT_STATE, JSON.stringify(state));
  }
}
