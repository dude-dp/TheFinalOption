import { logError, logInfo } from '../logger.js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_MTF_WEBHOOK || process.env.DISCORD_WEBHOOK_URL || '';

export async function sendMTFAlert(stock: {
  tradingsymbol: string;
  current_price: number;
  mtf_margin_multiplier: number;
  sector: string;
  distance_from_vwap_pct: number;
  rvol: number;
  rsi_14: number;
  suggested_sl: number;
}) {
  if (!DISCORD_WEBHOOK_URL) {
    logInfo(`[NOTIFY] Discord alert skipped for ${stock.tradingsymbol} (DISCORD_MTF_WEBHOOK not set).`);
    return;
  }

  const message = {
    embeds: [{
      title: `🚨 MTF Breakout: ${stock.tradingsymbol}`,
      color: 3447003, // Institutional Blue
      url: `https://in.tradingview.com/chart/?symbol=NSE:${stock.tradingsymbol}`,
      fields: [
        { name: 'LTP', value: `₹${stock.current_price}`, inline: true },
        { name: 'Leverage', value: `${stock.mtf_margin_multiplier}x`, inline: true },
        { name: 'Sector', value: `${stock.sector}`, inline: true },
        { name: 'VWAP Extension', value: `${stock.distance_from_vwap_pct}%`, inline: true },
        { name: 'RVOL (Volume)', value: `${stock.rvol}x`, inline: true },
        { name: 'RSI (14)', value: `${stock.rsi_14}`, inline: true },
        { name: 'Target Stop Loss', value: `₹${stock.suggested_sl} (2x ATR)`, inline: false },
      ],
      footer: { text: 'TheFinalOption • 15m Quant Screener' },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!res.ok) {
      logError(`[NOTIFY] Discord Webhook HTTP Error: ${res.status}`);
    } else {
      logInfo(`[NOTIFY] 📲 Sent Discord Sniper Alert for ${stock.tradingsymbol}!`);
    }
  } catch (err: any) {
    logError(`[NOTIFY] Failed to send Discord alert for ${stock.tradingsymbol}: ${err.message}`);
  }
}
