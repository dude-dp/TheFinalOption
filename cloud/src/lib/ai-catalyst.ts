// ============================================
// TheFinalOption — AI Catalyst Confluence Engine
// Powered by Groq (Llama-3.3-70B / Llama-3.1-8B)
// Fetches real-time Indian financial news & synthesizes
// high-conviction fundamental/event catalysts.
// ============================================

import type { Env, AICatalystResult, NewsHeadlineItem } from './types';
import { logInfo, logWarn, logError } from './logger';

// Clean XML / HTML entities
function decodeXmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
    .trim();
}

/**
 * Fetch top real-time news headlines for an Indian NSE stock
 * Uses Google News India RSS & Yahoo Finance RSS (zero-auth, fast, fresh)
 */
export async function fetchStockNews(symbol: string): Promise<NewsHeadlineItem[]> {
  const cleanSymbol = symbol.replace(/^(NSE_|BSE_)/i, '').replace(/-(EQ|BE|SM)$/i, '').trim();
  const headlines: NewsHeadlineItem[] = [];

  try {
    // 1. Google News RSS for Indian Market
    const query = `${cleanSymbol} stock news NSE OR ${cleanSymbol} share price`;
    const googleRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

    const res = await fetch(googleRssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      },
      cf: { cacheTtl: 300 } // Cache 5 mins at Cloudflare edge
    });

    if (res.ok) {
      const xmlText = await res.text();
      // Match <item> blocks
      const itemRegex = /<item>[\s\S]*?<\/item>/gi;
      const items = xmlText.match(itemRegex) || [];

      for (const item of items.slice(0, 4)) {
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
        const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
        const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);

        let title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
        let source = sourceMatch ? decodeXmlEntities(sourceMatch[1]) : 'Financial News';
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString();
        const link = linkMatch ? linkMatch[1].trim() : '';

        // If title has " - SourceName" suffix, extract cleanly
        if (title.includes(' - ') && !sourceMatch) {
          const parts = title.split(' - ');
          source = parts.pop() || source;
          title = parts.join(' - ');
        }

        if (title) {
          headlines.push({
            title,
            source,
            published: pubDate,
            link
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`[AI Catalyst] News fetch error for ${cleanSymbol}:`, err?.message || err);
  }

  // If Google News returned fewer than 2 items, attempt Yahoo Finance RSS fallback
  if (headlines.length < 2) {
    try {
      const yfUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(cleanSymbol)}.NS`;
      const res = await fetch(yfUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cf: { cacheTtl: 300 }
      });
      if (res.ok) {
        const xml = await res.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
        for (const item of items.slice(0, 3)) {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
          const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
          const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
          const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
          if (title && !headlines.some(h => h.title === title)) {
            headlines.push({
              title,
              source: 'Yahoo Finance',
              published: pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString(),
              link: linkMatch ? linkMatch[1].trim() : ''
            });
          }
        }
      }
    } catch {
      // Ignore secondary fallback errors
    }
  }

  return headlines;
}

/**
 * Generate Institutional AI Catalyst Synthesis using Groq API
 */
export async function generateStockCatalyst(
  env: Env,
  symbol: string,
  setupInfo: {
    price: number;
    sector?: string;
    primarySignal: string;
    macdValue?: number;
    rsi?: number;
    adx?: number;
    rvol?: number;
    atr?: number;
    vwapDist?: number;
    conviction?: string;
  }
): Promise<AICatalystResult> {
  const cleanSymbol = symbol.replace(/^(NSE_|BSE_)/i, '').replace(/-(EQ|BE|SM)$/i, '').trim();
  const apiKey = env.GROQ_API_KEY || (env as any).VARS?.GROQ_API_KEY || '';

  // 1. Check KV Cache (TTL 12 hours) to avoid redundant API calls & rate limits
  const cacheKey = `catalyst:${cleanSymbol}`;
  if (env.TRADING_KV) {
    try {
      const cachedStr = await env.TRADING_KV.get(cacheKey);
      if (cachedStr) {
        const cachedObj = JSON.parse(cachedStr);
        return {
          ...cachedObj,
          modelUsed: 'Groq (Cached)'
        };
      }
    } catch {/* cache lookup failure is non-blocking */}
  }

  // 2. Fetch live news
  const headlines = await fetchStockNews(cleanSymbol);

  // 3. Format setup description for LLM
  const signalName = setupInfo.primarySignal.replace(/_/g, ' ');
  const newsContext = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title} (${h.published})`).join('\n')
    : 'No recent breaking news headlines found in the last 24-48 hours.';

  const prompt = `Stock: ${cleanSymbol} (NSE India)
Sector: ${setupInfo.sector || 'General Market'}
Current LTP: ₹${setupInfo.price.toFixed(2)}
Detected Quant Setup: ${signalName} (Conviction: ${setupInfo.conviction || 'NORMAL'})
Technical Indicators:
- MACD Value: ${setupInfo.macdValue?.toFixed(2) ?? 'N/A'}
- RSI(14): ${setupInfo.rsi?.toFixed(1) ?? 'N/A'}
- ADX Trend: ${setupInfo.adx?.toFixed(1) ?? 'N/A'}
- Relative Volume (RVOL): ${setupInfo.rvol ? setupInfo.rvol.toFixed(2) + 'x' : 'N/A'}
- VWAP Deviation: ${setupInfo.vwapDist ? (setupInfo.vwapDist > 0 ? '+' : '') + setupInfo.vwapDist.toFixed(2) + '%' : 'N/A'}
- Daily ATR: ₹${setupInfo.atr?.toFixed(2) ?? 'N/A'}

Recent Indian Financial News & Headlines:
${newsContext}

Task:
Analyze this quantitative setup and the recent news/events to produce a razor-sharp institutional catalyst summary. Explain WHY this stock is coiling, compressing, or setting up for an explosive breakout.

Respond strictly in valid JSON format with this exact structure:
{
  "catalyst": "1-2 sentence punchy institutional synthesis explaining the catalyst (earnings, order win, tariff/policy, technical squeeze, or sector accumulation)",
  "sentiment": "BULLISH" | "NEUTRAL" | "BEARISH",
  "catalystType": "EARNINGS" | "ORDER_WIN" | "SECTOR_ROTATION" | "REGULATORY" | "TECHNICAL_COIL" | "GENERAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

  // 4. Call Groq API with model fallback chain
  if (apiKey) {
    const modelsToTry = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

    for (const model of modelsToTry) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'You are an elite quantitative hedge fund analyst specializing in Indian Equities (NSE). You provide concise, ultra-high-conviction catalyst synthesis combining technical squeeze dynamics and fundamental news events. Output strictly valid JSON.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2,
            max_tokens: 300,
            response_format: { type: 'json_object' }
          })
        });

        if (groqRes.ok) {
          const data = await groqRes.json() as any;
          const rawContent = data.choices?.[0]?.message?.content;
          if (rawContent) {
            try {
              const parsed = JSON.parse(rawContent);
              const result: AICatalystResult = {
                catalyst: parsed.catalyst || `${cleanSymbol} is compressing in a ${signalName.toLowerCase()} pattern.`,
                sentiment: (['BULLISH', 'NEUTRAL', 'BEARISH'].includes(parsed.sentiment?.toUpperCase()) ? parsed.sentiment.toUpperCase() : 'BULLISH') as any,
                catalystType: (parsed.catalystType || 'TECHNICAL_COIL') as any,
                confidence: (parsed.confidence || 'HIGH') as any,
                headlines: headlines.slice(0, 3),
                modelUsed: `Groq (${model})`
              };

              // Cache in KV for 12 hours
              if (env.TRADING_KV) {
                try {
                  await env.TRADING_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 43200 });
                } catch {/* non-critical */}
              }

              return result;
            } catch {
              // If JSON parsing fails, fallback below
            }
          }
        } else if (groqRes.status === 429) {
          // Rate limited on current model — silently try next fallback model in loop
          continue;
        }
      } catch {
        // Silently catch fetch errors and try next model or fallback
      }
    }
  }

  // 5. Resilient Fallback if Groq API is rate-limited or unavailable
  const fallbackResult = generateFallbackCatalyst(cleanSymbol, setupInfo, headlines);

  // Cache fallback catalyst in KV for 2 hours to avoid spamming Groq API while rate-limited
  if (env.TRADING_KV) {
    try {
      await env.TRADING_KV.put(cacheKey, JSON.stringify(fallbackResult), { expirationTtl: 7200 });
    } catch {/* non-critical */}
  }

  return fallbackResult;
}

/**
 * Deterministic quantitative + headline synthesis fallback
 */
function generateFallbackCatalyst(
  symbol: string,
  setupInfo: {
    price: number;
    sector?: string;
    primarySignal: string;
    macdValue?: number;
    rsi?: number;
    adx?: number;
    rvol?: number;
    atr?: number;
    vwapDist?: number;
    conviction?: string;
  },
  headlines: NewsHeadlineItem[]
): AICatalystResult {
  const signal = setupInfo.primarySignal;
  let catalystDesc = '';
  let catalystType: AICatalystResult['catalystType'] = 'TECHNICAL_COIL';
  let sentiment: AICatalystResult['sentiment'] = 'BULLISH';

  if (signal === 'TIGHT_BASE_SQUEEZE') {
    catalystDesc = `${symbol} is coiling within an ultra-tight ATR base with significant volatility compression, signaling imminent pre-breakout expansion.`;
    catalystType = 'TECHNICAL_COIL';
  } else if (signal === 'VOL_EXHAUSTION') {
    catalystDesc = `Seller exhaustion detected on ${symbol} with volume falling below 40% of 20-day average; institutional bid support emerging near VWAP.`;
    catalystType = 'TECHNICAL_COIL';
  } else if (signal === 'PERFECT_TREND_STACK') {
    catalystDesc = `${symbol} exhibits pristine bullish EMA stacking (9 > 21 > 50 > 200) with momentum accumulation above VWAP in the ${setupInfo.sector || 'core'} sector.`;
    catalystType = 'SECTOR_ROTATION';
  } else if (signal === 'SUPPORT_DIP_BUY') {
    catalystDesc = `${symbol} completed a controlled pullback into its rising 21 EMA support band with RSI holding above 50, providing high Risk:Reward dip entry.`;
    catalystType = 'TECHNICAL_COIL';
  } else {
    catalystDesc = `${symbol} triggered a ${signal.replace(/_/g, ' ')} momentum setup at ₹${setupInfo.price.toFixed(2)} with positive MACD velocity.`;
    catalystType = 'GENERAL';
  }

  // If we have a fresh news headline, blend it into the catalyst
  if (headlines.length > 0) {
    const topNews = headlines[0];
    catalystDesc += ` Recent catalyst note: "${topNews.title.slice(0, 95)}..." [${topNews.source}].`;
  }

  return {
    catalyst: catalystDesc,
    sentiment,
    catalystType,
    confidence: setupInfo.conviction === 'HIGH' ? 'HIGH' : 'MEDIUM',
    headlines: headlines.slice(0, 3),
    modelUsed: 'Quant Confluence Engine (Fallback)'
  };
}
