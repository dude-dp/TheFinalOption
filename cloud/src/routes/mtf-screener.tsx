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
        body { 
          background-color: #f9fafb; 
          color: #111827; 
          font-family: "Satoshi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        }
        .table-row-hover:hover { 
          background-color: #f0f7ff; 
        }
      `}</style>
    </head>
    <body class="min-h-screen bg-gray-50 text-gray-900 selection:bg-blue-100">
      
      {/* --- INSTITUTIONAL LIGHT NAVBAR --- */}
      <header class="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md border-b border-gray-200 px-6 py-3 flex justify-between items-center transition-all duration-300 shadow-sm">
        
        {/* LEFT: Branding */}
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-black tracking-tight text-blue-900 font-sans">
            TheFinalOption
          </h1>
          <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-extrabold uppercase tracking-widest border border-blue-200">
            MTF Screener
          </span>
        </div>

        {/* CENTER: Navigation Pills & Search */}
        <div class="hidden lg:flex items-center gap-6">
          <nav class="flex bg-gray-100 p-1 rounded-full border border-gray-200 shadow-inner">
            <a href="/" class="px-5 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 rounded-full transition-colors">
              Live Terminal
            </a>
            <a href="/mtf-screener" class="px-5 py-1.5 text-xs font-bold text-blue-800 bg-white shadow-sm rounded-full transition-colors">
              MTF Radar
            </a>
          </nav>

          {/* Quick Search */}
          <div class="relative">
            <input 
              id="search-input"
              type="text" 
              placeholder="Filter ticker..." 
              class="bg-gray-50 border border-gray-200 text-sm rounded-full pl-8 pr-4 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all w-48 placeholder-gray-400 font-medium"
            />
            <svg class="w-4 h-4 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
        </div>

        {/* RIGHT: Telemetry & Status */}
        <div class="flex items-center gap-4">
          {/* API Fuel Gauge */}
          <div class="flex flex-col items-end mr-2">
            <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">API Fuel</span>
            <div class="flex items-center gap-2 mt-0.5">
              <div class="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div class="h-full bg-emerald-500 transition-all duration-300" style="width: 95%"></div>
              </div>
              <span class="text-[10px] font-mono text-gray-600 font-bold">190/200</span>
            </div>
          </div>

          {/* Mode Indicator */}
          <div class="flex items-center gap-2 pl-4 border-l border-gray-200 hidden md:flex">
            <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Mode</span>
            <span class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-[10px] font-mono font-bold border border-gray-200">
              MANUAL
            </span>
          </div>

          {/* System Status & Countdown */}
          <div class="flex flex-col items-end pl-4 border-l border-gray-200">
            <div class="flex items-center gap-2">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span class="text-xs font-bold text-gray-800 tracking-wide">SYSTEM ALIVE</span>
            </div>
            <span id="countdown-label" class="text-[9px] font-medium text-gray-400 mt-0.5">
              Next scan in: 60s
            </span>
          </div>
        </div>
      </header>

      {/* --- MAIN DATA TABLE --- */}
      <main class="max-w-7xl mx-auto px-6 py-8">
        
        {/* Statistics Bar */}
        <div class="flex gap-4 mb-6">
          <div class="bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm flex-1">
             <div class="text-xs text-gray-500 font-bold uppercase tracking-wider">Active Setups</div>
             <div id="stat-total-setups" class="text-3xl font-black text-gray-900 mt-1">0</div>
          </div>
          <div class="bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm flex-[3]">
             <div class="text-xs text-gray-500 font-bold uppercase tracking-wider">Current Filter Logic</div>
             <div class="flex items-center gap-3 mt-2">
                <span class="text-sm font-bold text-blue-800 bg-blue-50 px-2.5 py-1 rounded border border-blue-100">
                  MACD 15m Zero-Line Cross
                </span>
                <span class="text-gray-300 font-bold">+</span>
                <span class="text-sm font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                  RVOL Expansion Filter
                </span>
             </div>
          </div>
        </div>

        {/* The White Data Table */}
        <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm whitespace-nowrap">
              <thead class="bg-gray-50/80 border-b border-gray-200 uppercase tracking-wider text-[11px] font-black text-gray-500">
                <tr>
                  <th class="px-6 py-4">Symbol</th>
                  <th class="px-6 py-4">LTP</th>
                  <th class="px-6 py-4 text-center">Leverage</th>
                  <th class="px-6 py-4">VWAP Dist %</th>
                  <th class="px-6 py-4">MACD Status</th>
                  <th class="px-6 py-4">RSI (14)</th>
                  <th class="px-6 py-4">Trend (ADX)</th>
                  <th class="px-6 py-4">RVOL</th>
                  <th class="px-6 py-4">Struct SL (ATR)</th>
                  <th class="px-6 py-4 text-right">Review</th>
                </tr>
              </thead>
              <tbody id="screener-table-body" class="divide-y divide-gray-100">
                <tr>
                  <td colSpan={10} class="px-6 py-16 text-center text-gray-400 font-medium">
                    Loading MTF setups...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Client-Side Refresh, Search, and Countdown Logic */}
      <script>{`
        let allStocks = [];
        let nextUpdateIn = 60;

        async function fetchMTFSetups() {
          try {
            const res = await fetch('/api/mtf-screener');
            if (!res.ok) return;
            const response = await res.json();
            if (response.success) {
              allStocks = response.data || [];
              applyFilter();
              nextUpdateIn = 60;
            }
          } catch (e) {
            console.error("Failed to fetch MTF data:", e);
          }
        }

        function applyFilter() {
          const query = document.getElementById('search-input').value.toLowerCase();
          const filtered = allStocks.filter(stock => 
            stock.tradingsymbol.toLowerCase().includes(query) ||
            (stock.sector && stock.sector.toLowerCase().includes(query))
          );
          renderTable(filtered);
          document.getElementById('stat-total-setups').innerText = filtered.length;
        }

        function renderTable(stocks) {
          const tbody = document.getElementById('screener-table-body');
          if (!stocks || stocks.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="10" class="px-6 py-20 text-center">
                  <div class="text-gray-300 mb-3">
                    <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                    </svg>
                  </div>
                  <p class="text-gray-600 font-bold text-base">No active crossovers match your search.</p>
                  <p class="text-sm text-gray-400 mt-1 font-medium">Waiting for the next 15m scan window...</p>
                </td>
              </tr>\`;
            return;
          }

          tbody.innerHTML = stocks.map(stock => {
            const macdBadge = stock.macd_signal === 'ZERO_LINE_CROSS'
              ? \`<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                  </svg>
                  Zero Line Cross
                 </span>\`
              : \`<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Bullish
                 </span>\`;

            const rsiClass = stock.rsi_14 > 60 ? 'text-emerald-600 font-extrabold' : (stock.rsi_14 < 40 ? 'text-red-600 font-extrabold' : 'text-gray-600 font-bold');
            
            const adxFlame = stock.adx_trend > 25 
              ? \`<span class="inline-flex items-center gap-0.5 ml-1 text-red-500 font-bold">
                  <svg class="w-3 h-3 inline fill-current" viewBox="0 0 24 24">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  </svg>
                 </span>\` 
              : '';

            const vwapDistClass = stock.distance_from_vwap_pct > 3.0
              ? 'text-red-600 bg-red-50 border-red-200 font-bold'
              : 'text-gray-700 bg-gray-100 border-gray-200 font-medium';

            const formattedSL = Number(stock.suggested_sl || (stock.current_price * 0.98)).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });

            return \`
              <tr class="table-row-hover transition-colors group border-b border-gray-100">
                <td class="px-6 py-4">
                  <span class="font-black text-gray-900 text-base block">\${stock.tradingsymbol}</span>
                  <span class="text-[10px] font-black text-gray-400 tracking-wider uppercase">\${stock.sector || 'GENERAL'}</span>
                </td>
                <td class="px-6 py-4 font-mono font-extrabold text-gray-800 text-base">₹\${Number(stock.current_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td class="px-6 py-4 text-center">
                  <span class="bg-gray-100 text-gray-700 border border-gray-200 px-2.5 py-1 rounded text-xs font-black">
                    \${stock.mtf_margin_multiplier || 2.0}x
                  </span>
                </td>
                <td class="px-6 py-4 font-mono">
                  <span class="text-xs px-2.5 py-1 rounded border \${vwapDistClass}">
                    \${stock.distance_from_vwap_pct > 0 ? '+' : ''}\${stock.distance_from_vwap_pct}%
                  </span>
                </td>
                <td class="px-6 py-4">
                  \${macdBadge}
                  <span class="ml-2.5 font-mono text-xs text-gray-400 font-bold">(\${stock.macd_value})</span>
                </td>
                <td class="px-6 py-4 font-mono \${rsiClass}">\${stock.rsi_14}</td>
                <td class="px-6 py-4 font-mono font-bold text-gray-700">\${stock.adx_trend}\${adxFlame}</td>
                <td class="px-6 py-4 font-mono font-black text-gray-800">\${stock.rvol || 1.0}x</td>
                <td class="px-6 py-4 font-mono font-black text-red-600/90">₹\${formattedSL}</td>
                <td class="px-6 py-4 text-right">
                  <a 
                    href="https://pro.upstox.com/" 
                    target="_blank" 
                    rel="noreferrer"
                    class="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-gray-300 hover:border-blue-500 hover:text-blue-700 text-gray-700 px-4 py-1.5 rounded-lg text-xs font-black shadow-sm"
                  >
                    Chart
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                  </a>
                </td>
              </tr>
            \`;
          }).join('');
        }

        // Initialize Search Listener
        document.getElementById('search-input').addEventListener('input', applyFilter);

        // Initial Data Fetch
        fetchMTFSetups();

        // 60-Second Loop
        setInterval(fetchMTFSetups, 60000);

        // Countdown Timer
        setInterval(() => {
          if (nextUpdateIn > 0) {
            nextUpdateIn--;
          }
          document.getElementById('countdown-label').innerText = 'Next scan in: ' + nextUpdateIn + 's';
        }, 1000);
      `}</script>
    </body>
  </html>
);
