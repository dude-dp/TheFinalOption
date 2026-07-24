// cloud/src/routes/mtf-screener.tsx
import { jsx } from 'hono/jsx';

export const MTFScreenerPage = () => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Quant MTF Screener | TheFinalOption</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>{`
        body { background-color: #f9fafb; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .table-row-hover:hover { background-color: #f0f7ff; }
      `}</style>
    </head>
    <body class="min-h-screen bg-gray-50 text-gray-900 selection:bg-blue-100">
      
      {/* Clean, Bright Institutional Header */}
      <header class="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div>
              <h1 class="text-xl font-bold tracking-tight text-gray-900">
                Quant Screener <span class="text-blue-600">MTF</span>
              </h1>
              <p class="text-xs text-gray-500 font-medium">15-Minute MACD Crossover & Structural Risk Radar</p>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <a 
              href="/" 
              class="text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-all"
            >
              ← Option Dashboard
            </a>
            <span id="last-scan-time" class="text-xs text-gray-500 font-medium bg-gray-100 px-3 py-1.5 rounded-full">
              Last scan: --:--:--
            </span>
            <div class="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Feed
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main class="max-w-7xl mx-auto px-6 py-6">
        
        {/* Quant Statistics Bar */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm">
             <div class="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Active Setups</div>
             <div id="stat-total-setups" class="text-2xl font-extrabold text-gray-900 mt-1">0</div>
          </div>
          <div class="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm">
             <div class="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Timeframe</div>
             <div class="text-2xl font-extrabold text-gray-900 mt-1">15m Candles</div>
          </div>
          <div class="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm">
             <div class="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Primary Filter</div>
             <div class="text-xs font-bold text-blue-700 bg-blue-50 inline-block px-2 py-1 rounded mt-1.5 border border-blue-100">
               MACD Zero-Line Cross (15m)
             </div>
          </div>
          <div class="bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm">
             <div class="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Risk Metric</div>
             <div class="text-xs font-bold text-emerald-700 bg-emerald-50 inline-block px-2 py-1 rounded mt-1.5 border border-emerald-100">
               14-Period ATR Structural SL
             </div>
          </div>
        </div>

        {/* Crisp Data Table */}
        <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm whitespace-nowrap">
              <thead class="bg-gray-50 border-b border-gray-200 uppercase tracking-wider text-[11px] font-bold text-gray-500">
                <tr>
                  <th class="px-6 py-4">Symbol & Sector</th>
                  <th class="px-6 py-4">LTP</th>
                  <th class="px-6 py-4 text-center">Leverage</th>
                  <th class="px-6 py-4">VWAP Dist %</th>
                  <th class="px-6 py-4">MACD Signal</th>
                  <th class="px-6 py-4">RSI (14)</th>
                  <th class="px-6 py-4">ADX (14)</th>
                  <th class="px-6 py-4">RVOL</th>
                  <th class="px-6 py-4">Suggested SL</th>
                  <th class="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody id="screener-table-body" class="divide-y divide-gray-100">
                <tr>
                  <td colSpan={10} class="px-6 py-12 text-center text-gray-400">
                    Loading MTF setups...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Client-Side Refresh Script */}
      <script>{`
        async function fetchMTFSetups() {
          try {
            const res = await fetch('/api/mtf-screener');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success) {
              renderTable(data.data || []);
              document.getElementById('last-scan-time').innerText = 'Last scan: ' + new Date().toLocaleTimeString();
              document.getElementById('stat-total-setups').innerText = (data.data || []).length;
            }
          } catch (e) {
            console.error('Failed to fetch MTF setups:', e);
          }
        }

        function renderTable(stocks) {
          const tbody = document.getElementById('screener-table-body');
          if (!stocks || stocks.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="10" class="px-6 py-16 text-center">
                  <div class="text-gray-400 mb-2">
                    <svg class="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                  </div>
                  <p class="text-gray-600 font-bold">No 15-minute crossovers detected.</p>
                  <p class="text-xs text-gray-400 mt-1">Waiting for the next 15m scan window...</p>
                </td>
              </tr>\`;
            return;
          }

          tbody.innerHTML = stocks.map(stock => {
            const macdBadge = stock.macd_signal === 'ZERO_LINE_CROSS'
              ? \`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  ⚡ Zero Cross
                 </span>\`
              : \`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Bullish
                 </span>\`;

            const rsiClass = stock.rsi_14 > 60 ? 'text-emerald-600 font-bold' : (stock.rsi_14 < 40 ? 'text-red-600 font-bold' : 'text-gray-700');
            const adxFlame = stock.adx_trend > 25 ? ' 🔥' : '';
            const vwapDistBadge = stock.distance_from_vwap_pct > 3.0
              ? \`<span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">+\${stock.distance_from_vwap_pct}% (Ext)</span>\`
              : \`<span class="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded">\${stock.distance_from_vwap_pct > 0 ? '+' : ''}\${stock.distance_from_vwap_pct}%</span>\`;

            return \`
              <tr class="table-row-hover transition-colors group border-b border-gray-100">
                <td class="px-6 py-4">
                  <div class="font-bold text-gray-900 text-base">\${stock.tradingsymbol}</div>
                  <div class="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest mt-0.5">\${stock.sector || 'GENERAL'}</div>
                </td>
                <td class="px-6 py-4 font-mono font-bold text-gray-900 text-base">₹\${Number(stock.current_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td class="px-6 py-4 text-center">
                  <span class="bg-gray-100 text-gray-800 border border-gray-200 px-2.5 py-1 rounded text-xs font-bold">
                    \${stock.mtf_margin_multiplier || 2.0}x
                  </span>
                </td>
                <td class="px-6 py-4 font-mono">\${vwapDistBadge}</td>
                <td class="px-6 py-4">
                  \${macdBadge}
                  <span class="ml-2 font-mono text-xs text-gray-400">(\${stock.macd_value})</span>
                </td>
                <td class="px-6 py-4 font-mono \${rsiClass}">\${stock.rsi_14}</td>
                <td class="px-6 py-4 font-mono font-medium text-gray-700">\${stock.adx_trend}\${adxFlame}</td>
                <td class="px-6 py-4 font-mono font-bold text-gray-800">\${stock.rvol || 1.0}x</td>
                <td class="px-6 py-4 font-mono font-bold text-emerald-700">₹\${Number(stock.suggested_sl).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td class="px-6 py-4 text-right">
                  <a 
                    href="https://pro.upstox.com/" 
                    target="_blank" 
                    rel="noreferrer"
                    class="inline-block bg-white border border-gray-300 hover:border-blue-500 hover:text-blue-600 text-gray-700 px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all"
                  >
                    Chart ↗
                  </a>
                </td>
              </tr>
            \`;
          }).join('');
        }

        fetchMTFSetups();
        setInterval(fetchMTFSetups, 60000);
      `}</script>
    </body>
  </html>
);
