// local-daemon/src/liquidity.ts
import { MarketDepth, OrderBookLevel } from './ws-client.js';
import { logger } from './logger.js';

export interface ExecutionMetrics {
  targetQuantity: number;
  expectedExecutionPrice: number;
  slippagePoints: number;
  isLiquiditySufficient: boolean;
  filledQuantity: number;
}

export class LiquidityScanner {
  
  /**
   * Sweeps the order book to calculate the exact weighted average execution price
   * for a given quantity BEFORE an order is placed.
   *
   * @param transactionType 'BUY' or 'SELL'
   * @param quantity The total number of units (lots * lotSize) to execute
   * @param ltp The Last Traded Price (used as a fallback baseline)
   * @param depth The current top 5 market depth levels from the WebSocket
   */
  public scanOrderBook(
    transactionType: 'BUY' | 'SELL',
    quantity: number,
    ltp: number,
    depth: MarketDepth
  ): ExecutionMetrics {
    
    // 1. Target the correct side of the book
    // If we BUY, we consume the ASKS. If we SELL, we consume the BIDS.
    const book: OrderBookLevel[] = transactionType === 'BUY' ? depth.asks : depth.bids;
    
    // Safety Net: If the WebSocket tick was malformed or missing depth
    if (!book || book.length === 0) {
      logger.warn(`[LIQUIDITY] Order book empty for ${transactionType}. Falling back to LTP.`);
      return {
        targetQuantity: quantity,
        expectedExecutionPrice: ltp,
        slippagePoints: 999, // Flagging as highly dangerous (infinite slippage)
        isLiquiditySufficient: false,
        filledQuantity: 0
      };
    }

    // 2. Sort the book to ensure absolute precision
    // BUYs need the lowest ask first. SELLs need the highest bid first.
    const sortedBook = [...book].sort((a, b) => {
      return transactionType === 'BUY' ? a.price - b.price : b.price - a.price;
    });

    const bestAvailablePrice = sortedBook[0].price;
    let remainingQuantity = quantity;
    let totalCost = 0;
    let filledQuantity = 0;

    // 3. Sweep the book mathematically
    for (const level of sortedBook) {
      if (remainingQuantity <= 0) break; // Order fully consumed

      // We can only consume what is available at this price level
      const fillableAtLevel = Math.min(remainingQuantity, level.quantity);
      
      totalCost += fillableAtLevel * level.price;
      filledQuantity += fillableAtLevel;
      remainingQuantity -= fillableAtLevel;
    }

    const isLiquiditySufficient = remainingQuantity === 0;
    
    // 4. Calculate the true Weighted Average Price (WAP)
    const expectedExecutionPrice = filledQuantity > 0 ? totalCost / filledQuantity : ltp;
    
    // 5. Calculate precise slippage in points
    const slippagePoints = Math.abs(expectedExecutionPrice - bestAvailablePrice);

    return {
      targetQuantity: quantity,
      expectedExecutionPrice,
      slippagePoints,
      isLiquiditySufficient,
      filledQuantity
    };
  }
}

export const liquidityScanner = new LiquidityScanner();
