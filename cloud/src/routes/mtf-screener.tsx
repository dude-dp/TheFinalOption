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
          background-color: #f8fafc; 
          color: #0f172a; 
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        }
        .table-row-hover:hover { 
          background-color: #f1f5f9; 
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Custom scrollbars */
        ::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 9999px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </head>
    <body class="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 antialiased">
      {/* Toast Notification Container */}
      <div id="toast-container" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"></div>

      {/* --- INSTITUTIONAL LIGHT NAVBAR --- */}
      <header class="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 py-3 flex justify-between items-center transition-all duration-300 shadow-xs">

        {/* LEFT: Branding */}
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-black tracking-tight text-slate-900 font-sans">
            TheFinalOption
          </h1>
          <span class="px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-extrabold uppercase tracking-widest border border-blue-200 shadow-xs">
            MTF Screener
          </span>
        </div>

        {/* CENTER: Navigation Pills & Search */}
        <div class="hidden lg:flex items-center gap-6">
          <nav class="flex bg-slate-100 p-1 rounded-full border border-slate-200 shadow-inner">
            <a href="/" class="px-5 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 rounded-full transition-colors">
              Live Terminal
            </a>
            <a href="/mtf-screener" class="px-5 py-1.5 text-xs font-bold text-blue-800 bg-white shadow-xs rounded-full transition-colors">
              MTF Radar
            </a>
          </nav>

          {/* Quick Search */}
          <div class="relative">
            <input
              id="search-input"
              type="text"
              placeholder="Filter ticker or sector..."
              class="bg-slate-50 border border-slate-200 text-xs rounded-full pl-8 pr-4 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all w-60 placeholder-slate-400 font-medium"
            />
            <svg class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
        </div>

        {/* RIGHT: Telemetry & Status */}
        <div class="flex items-center gap-3 sm:gap-4">
          {/* API Fuel Gauge */}
          <div class="group hidden sm:flex items-center gap-3 px-3 py-1.5 bg-white border border-slate-200 rounded-full shadow-xs hover:border-emerald-300 transition-all duration-300 cursor-default">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-emerald-600 transition-colors">API Fuel</span>
            <div class="flex items-center gap-2">
              <div class="relative w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div class="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-1000 ease-out" style="width: 95%">
                  <div class="absolute top-0 left-0 w-full h-full bg-white/30 animate-pulse"></div>
                </div>
              </div>
              <span class="text-[10px] font-mono font-black text-slate-700 tabular-nums">
                190<span class="text-slate-400 font-semibold">/200</span>
              </span>
            </div>
          </div>

          {/* System Status & Countdown */}
          <div class="flex flex-col items-end pl-3 border-l border-slate-200">
            <div class="flex items-center gap-2">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span class="text-xs font-bold text-slate-800 tracking-wide">SYSTEM ALIVE</span>
            </div>
            <span id="countdown-label" class="text-[9px] font-medium text-slate-400 mt-0.5">
              Next scan in: 60s
            </span>
          </div>

          {/* Manual Run Scan Button */}
          <div class="flex items-center gap-3 border-l border-slate-200 pl-3">
            <button
              id="trigger-scan-btn"
              type="button"
              class="relative overflow-hidden group flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-xs font-black transition-all bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-md hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-95 cursor-pointer border border-blue-400/20"
            >
              <div class="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 ease-in-out"></div>
              <svg id="trigger-scan-icon" class="w-3.5 h-3.5 text-blue-100 drop-shadow-xs group-hover:animate-pulse" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
              <span id="trigger-scan-text" class="tracking-wider uppercase drop-shadow-xs z-10">Run Scan</span>
            </button>
          </div>
        </div>
      </header>

      {/* --- MAIN DATA CONTAINER — REMOVED HEAVY SIDE MARGINS/PADDING --- */}
      <main class="w-full max-w-[1750px] mx-auto px-2 sm:px-4 lg:px-6 py-6 space-y-6">

        {/* Top Control & Metrics Summary Bar */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Active Setups */}
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Setups</div>
              <div id="stat-total-setups" class="text-2xl sm:text-3xl font-black text-slate-900 mt-0.5">0</div>
            </div>
            <div class="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
              </svg>
            </div>
          </div>

          {/* High Conviction Count */}
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">High Conviction</div>
              <div id="stat-high-conviction" class="text-2xl sm:text-3xl font-black text-amber-600 mt-0.5">0</div>
            </div>
            <div class="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 font-bold">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </div>
          </div>

          {/* Active Filter Logic */}
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs md:col-span-2 flex flex-col justify-between">
            <div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Quantitative Confluence Logic</div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <span class="text-xs font-bold text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                MACD 15m Zero-Line Cross
              </span>
              <span class="text-slate-300 font-bold">+</span>
              <span class="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                RVOL &gt; 1.0x Expansion
              </span>
              <span class="text-slate-300 font-bold">+</span>
              <span class="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-100 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                2x ATR Structural SL
              </span>
            </div>
          </div>
        </div>

        {/* --- STUNNING ENHANCED RADAR TABLE CARD --- */}
        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs transition-all duration-300">

          {/* COLLAPSIBLE HEADER CONTROL BAR */}
          <div class="bg-slate-900 text-white px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 shadow-md">
            
            {/* Left: Title, Live Status & Badge */}
            <div class="flex items-center gap-3">
              <span class="relative flex h-3 w-3">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div>
                <h2 class="text-sm font-black tracking-wider uppercase text-white flex items-center gap-2">
                  Quant MTF Radar Setups
                </h2>
              </div>
              <span id="setup-count-badge" class="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-xs font-mono font-bold border border-blue-500/30">
                0 setups
              </span>
            </div>

            {/* Center: Quick Filter Pills */}
            <div class="flex flex-wrap items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
              <button 
                onclick="setFilterTab('ALL')" 
                id="tab-ALL" 
                class="px-3 py-1 rounded-lg text-xs font-bold transition-all bg-blue-600 text-white shadow-xs cursor-pointer"
              >
                All
              </button>
              <button 
                onclick="setFilterTab('HIGH')" 
                id="tab-HIGH" 
                class="px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-700/60 cursor-pointer"
              >
                ⚡ High Conviction
              </button>
              <button 
                onclick="setFilterTab('ZERO_CROSS')" 
                id="tab-ZERO_CROSS" 
                class="px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-700/60 cursor-pointer"
              >
                🎯 Zero Cross
              </button>
              <button 
                onclick="setFilterTab('HIGH_RVOL')" 
                id="tab-HIGH_RVOL" 
                class="px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-700/60 cursor-pointer"
              >
                🔥 High RVOL
              </button>
            </div>

            {/* Right: Controls (Expand/Collapse All Rows & Collapse Entire Table) */}
            <div class="flex items-center gap-2">
              <button
                id="toggle-all-rows-btn"
                onclick="toggleExpandAllRows()"
                class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all border border-slate-700/80 cursor-pointer"
                title="Toggle detail drawer for all rows"
              >
                <svg id="toggle-all-rows-icon" class="w-3.5 h-3.5 transition-transform duration-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
                </svg>
                <span id="toggle-all-rows-text">Expand All</span>
              </button>

              {/* COLLAPSE / EXPAND TABLE TOGGLE BUTTON */}
              <button
                id="table-collapse-btn"
                onclick="toggleTableCollapse()"
                class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-xs font-extrabold transition-all border border-slate-700/80 cursor-pointer shadow-xs"
              >
                <span id="table-collapse-text">Collapse Table</span>
                <svg id="table-collapse-icon" class="w-4 h-4 transition-transform duration-300" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* COLLAPSED TICKER SUMMARY BANNER (Shown when table is collapsed) */}
          <div id="table-collapsed-summary" class="hidden bg-slate-800 text-slate-300 px-5 py-3 border-b border-slate-700 flex items-center justify-between text-xs font-mono">
            <div class="flex items-center gap-3 overflow-x-auto py-0.5 scrollbar-none">
              <span class="text-slate-400 font-extrabold uppercase text-[10px] tracking-wider shrink-0">Radar Collapsed:</span>
              <div id="collapsed-tickers-list" class="flex items-center gap-2 shrink-0">
                {/* Dynamically populated mini ticker pills */}
              </div>
            </div>
            <button 
              onclick="toggleTableCollapse()"
              class="text-blue-400 hover:text-blue-300 font-bold shrink-0 ml-4 underline cursor-pointer"
            >
              Show Table
            </button>
          </div>

          {/* TABLE CONTAINER WRAPPER WITH COLLAPSIBLE ANIMATION */}
          <div id="screener-table-container" class="overflow-x-auto transition-all duration-300 max-h-[2500px]">
            <table class="w-full text-left text-xs sm:text-sm whitespace-nowrap">
              <thead class="bg-slate-50 border-b border-slate-200 uppercase tracking-wider text-[11px] font-black text-slate-500">
                <tr>
                  <th class="px-3 sm:px-4 py-3.5 text-center w-10"></th>
                  <th class="px-4 py-3.5">Asset & Volume</th>
                  <th class="px-4 py-3.5">LTP</th>
                  <th class="px-4 py-3.5">VWAP Ext.</th>
                  <th class="px-4 py-3.5">MACD 15m</th>
                  <th class="px-4 py-3.5">RSI (14)</th>
                  <th class="px-4 py-3.5">Struct SL (ATR)</th>
                  <th class="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody id="screener-table-body" class="divide-y divide-slate-100">
                <tr>
                  <td colSpan={8} class="px-6 py-16 text-center text-slate-400 font-medium">
                    <div class="flex flex-col items-center justify-center gap-3">
                      <svg class="w-8 h-8 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span>Loading MTF setups...</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </main>

      {/* Client-Side Refresh, Search, and Countdown Logic */}
      <script dangerouslySetInnerHTML={{ __html: `
        let allStocks = [];
        let nextUpdateIn = 60;
        let activeTab = 'ALL';
        let isTableCollapsed = false;
        let expandedRows = new Set();

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

        function setFilterTab(tab) {
          activeTab = tab;
          ['ALL', 'HIGH', 'ZERO_CROSS', 'HIGH_RVOL'].forEach(t => {
            const btn = document.getElementById('tab-' + t);
            if (btn) {
              if (t === tab) {
                btn.className = 'px-3 py-1 rounded-lg text-xs font-bold transition-all bg-blue-600 text-white shadow-xs cursor-pointer';
              } else {
                btn.className = 'px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-700/60 cursor-pointer';
              }
            }
          });
          applyFilter();
        }

        function applyFilter() {
          const query = document.getElementById('search-input').value.toLowerCase().trim();
          let filtered = allStocks.filter(stock => 
            stock.tradingsymbol.toLowerCase().includes(query) ||
            (stock.sector && stock.sector.toLowerCase().includes(query))
          );

          if (activeTab === 'HIGH') {
            filtered = filtered.filter(s => s.conviction === 'HIGH');
          } else if (activeTab === 'ZERO_CROSS') {
            filtered = filtered.filter(s => s.macd_signal === 'ZERO_LINE_CROSS');
          } else if (activeTab === 'HIGH_RVOL') {
            filtered = filtered.filter(s => Number(s.rvol || 0) > 2.5);
          }

          renderTable(filtered);
          updateSummaryMetrics(filtered);
          updateCollapsedSummary(filtered);
        }

        function updateSummaryMetrics(stocks) {
          const totalElem = document.getElementById('stat-total-setups');
          const highElem = document.getElementById('stat-high-conviction');
          const badgeElem = document.getElementById('setup-count-badge');
          
          if (totalElem) totalElem.innerText = stocks.length;
          if (highElem) highElem.innerText = stocks.filter(s => s.conviction === 'HIGH').length;
          if (badgeElem) badgeElem.innerText = stocks.length + ' setups';
        }

        function toggleTableCollapse() {
          isTableCollapsed = !isTableCollapsed;
          const container = document.getElementById('screener-table-container');
          const summary = document.getElementById('table-collapsed-summary');
          const btnText = document.getElementById('table-collapse-text');
          const btnIcon = document.getElementById('table-collapse-icon');

          if (isTableCollapsed) {
            if (container) {
              container.style.maxHeight = '0px';
              container.style.opacity = '0';
              setTimeout(() => { container.classList.add('hidden'); }, 300);
            }
            if (summary) summary.classList.remove('hidden');
            if (btnText) btnText.innerText = 'Expand Table';
            if (btnIcon) btnIcon.style.transform = 'rotate(180deg)';
          } else {
            if (container) {
              container.classList.remove('hidden');
              requestAnimationFrame(() => {
                container.style.maxHeight = '2500px';
                container.style.opacity = '1';
              });
            }
            if (summary) summary.classList.add('hidden');
            if (btnText) btnText.innerText = 'Collapse Table';
            if (btnIcon) btnIcon.style.transform = 'rotate(0deg)';
          }
        }

        function updateCollapsedSummary(stocks) {
          const listElem = document.getElementById('collapsed-tickers-list');
          if (!listElem) return;
          if (stocks.length === 0) {
            listElem.innerHTML = '<span class="text-slate-400">No active setups</span>';
            return;
          }
          listElem.innerHTML = stocks.slice(0, 10).map(s => \`
            <span class="px-2 py-0.5 rounded bg-slate-700 text-white font-bold text-[11px] flex items-center gap-1">
              \${s.tradingsymbol}
              <span class="text-[9px] text-emerald-400 font-mono">₹\${Number(s.current_price).toFixed(1)}</span>
            </span>
          \`).join('') + (stocks.length > 10 ? \`<span class="text-slate-400 text-[10px]">+\${stocks.length - 10} more</span>\` : '');
        }

        function toggleRowDetails(symbol) {
          const detailRow = document.getElementById('detail-row-' + symbol);
          const chevron = document.getElementById('chevron-' + symbol);
          if (!detailRow) return;

          if (expandedRows.has(symbol)) {
            expandedRows.delete(symbol);
            detailRow.classList.add('hidden');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
          } else {
            expandedRows.add(symbol);
            detailRow.classList.remove('hidden');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
          }
        }

        function toggleExpandAllRows() {
          const allSymbols = allStocks.map(s => s.tradingsymbol);
          const btnText = document.getElementById('toggle-all-rows-text');
          const btnIcon = document.getElementById('toggle-all-rows-icon');

          if (expandedRows.size === allSymbols.length && allSymbols.length > 0) {
            expandedRows.clear();
            allSymbols.forEach(sym => {
              const row = document.getElementById('detail-row-' + sym);
              const chev = document.getElementById('chevron-' + sym);
              if (row) row.classList.add('hidden');
              if (chev) chev.style.transform = 'rotate(0deg)';
            });
            if (btnText) btnText.innerText = 'Expand All';
            if (btnIcon) btnIcon.style.transform = 'rotate(0deg)';
          } else {
            allSymbols.forEach(sym => {
              expandedRows.add(sym);
              const row = document.getElementById('detail-row-' + sym);
              const chev = document.getElementById('chevron-' + sym);
              if (row) row.classList.remove('hidden');
              if (chev) chev.style.transform = 'rotate(180deg)';
            });
            if (btnText) btnText.innerText = 'Collapse All';
            if (btnIcon) btnIcon.style.transform = 'rotate(180deg)';
          }
        }

        function showToast(message, type = 'success') {
          const container = document.getElementById('toast-container');
          if (!container) return;
          const toast = document.createElement('div');
          toast.className = 'pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg border text-xs font-bold flex items-center gap-2 transition-all duration-300 animate-fade-in ' + 
            (type === 'success' ? 'bg-slate-900 text-white border-emerald-500/50' : 'bg-slate-900 text-white border-red-500/50');
          toast.innerHTML = \`
            <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>\${message}</span>
          \`;
          container.appendChild(toast);
          setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
          }, 3000);
        }

        function copyTradePlan(symbol, price, sl, atr, rvol) {
          const risk = price - sl;
          const target1 = (price + risk * 1.5).toFixed(2);
          const target2 = (price + risk * 3.0).toFixed(2);
          const planText = '🎯 MTF TRADE PLAN — ' + symbol + '\\n' +
            'LTP: ₹' + price + '\\n' +
            'Stop Loss: ₹' + sl + ' (2x ATR: ₹' + atr + ')\\n' +
            'Target 1 (1.5R): ₹' + target1 + '\\n' +
            'Target 2 (3.0R): ₹' + target2 + '\\n' +
            'RVOL: ' + rvol + 'x\\n' +
            'Generated via TheFinalOption MTF Screener';
          
          if (navigator.clipboard) {
            navigator.clipboard.writeText(planText).then(() => {
              showToast('Copied ' + symbol + ' Trade Plan to clipboard!');
            }).catch(() => {
              showToast('Failed to copy plan', 'error');
            });
          } else {
            showToast('Copied ' + symbol + ' Trade Plan!');
          }
        }

        function renderTable(stocks) {
          const tbody = document.getElementById('screener-table-body');
          if (!stocks || stocks.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="8" class="px-6 py-20 text-center">
                  <div class="text-slate-300 mb-3">
                    <svg class="w-12 h-12 mx-auto stroke-current" fill="none" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                    </svg>
                  </div>
                  <p class="text-slate-700 font-bold text-base">No active setups match your criteria.</p>
                  <p class="text-xs text-slate-400 mt-1 font-medium">Scanning live intraday 15m & 3H crossovers on Upstox...</p>
                </td>
              </tr>\`;
            return;
          }

          // Sort: HIGH conviction first, then by MACD value descending
          const sorted = [...stocks].sort((a, b) => {
            if (a.conviction === 'HIGH' && b.conviction !== 'HIGH') return -1;
            if (b.conviction === 'HIGH' && a.conviction !== 'HIGH') return 1;
            return Number(b.macd_value) - Number(a.macd_value);
          });

          const signalMap = {
            'ZERO_LINE_CROSS':    { label: 'Zero Line Cross', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
            'SIGNAL_LINE_CROSS':  { label: 'Signal Cross', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
            'APPROACHING_ZERO':   { label: 'Approaching Zero', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: 'M5 10l7-7m0 0l7 7m-7-7v18' },
            'EMA_GOLDEN_CROSS':   { label: 'EMA Golden Cross', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
            'BULLISH_ENGULFING':  { label: 'Bullish Engulfing', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'M5 15l7-7 7 7' },
            'HAMMER':             { label: 'Hammer', bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: 'M12 19V5m-7 7l7-7 7 7' },
            'RSI_REVERSAL':       { label: 'RSI Reversal', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
            'RSI_50_CROSS':       { label: 'RSI 50 Cross', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
            'BULLISH_MOMENTUM':   { label: 'Bullish', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'M5 15l7-7 7 7' },
          };

          tbody.innerHTML = sorted.map(stock => {
            const sym = stock.tradingsymbol;
            const isExpanded = expandedRows.has(sym);

            const sig = signalMap[stock.macd_signal] || signalMap['BULLISH_MOMENTUM'];
            const macdBadge = \`<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider \${sig.bg} \${sig.text} border \${sig.border}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="\${sig.icon}"></path>
                </svg>
                \${sig.label}
              </span>\`;

            const rsiVal = Number(stock.rsi_14 || 50);
            const rsiClass = rsiVal > 60 ? 'text-emerald-600 font-extrabold' : (rsiVal < 40 ? 'text-red-600 font-extrabold' : 'text-slate-600 font-bold');
            
            const rvolVal = Number(stock.rvol || 1.0);
            const isHighRvol = rvolVal > 2.5;
            const rvolBadgeClass = isHighRvol
              ? 'bg-orange-100 text-orange-700 border-orange-200 font-extrabold'
              : 'bg-slate-100 text-slate-600 border-slate-200 font-bold';

            const rvolFlameSvg = isHighRvol
              ? \`<svg class="w-3 h-3 inline fill-current text-orange-600 mr-0.5" viewBox="0 0 24 24">
                  <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                 </svg>\`
              : '';

            const distVwap = Number(stock.distance_from_vwap_pct || 0);
            const vwapDistClass = distVwap > 2.0
              ? 'text-amber-600 font-bold'
              : (distVwap < 0 ? 'text-blue-600 font-bold' : 'text-emerald-600 font-bold');

            const priceNum = Number(stock.current_price || 0);
            const atrVal = Number(stock.atr_value || (priceNum * 0.015)).toFixed(2);
            const rawSL = stock.suggested_sl || (priceNum - Number(atrVal) * 2);
            const formattedSL = Number(rawSL).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });

            const isHighConviction = stock.conviction === 'HIGH';
            const convictionBadge = isHighConviction
              ? \`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-gradient-to-r from-amber-400 to-yellow-500 text-white shadow-xs" title="Dual-Timeframe Confirmed: 15m + 3H MACD aligned">
                  <svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  HIGH
                </span>\`
              : \`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-slate-100 text-slate-500 border border-slate-200" title="15m signal only">
                  15m
                </span>\`;

            const marginMult = stock.mtf_margin_multiplier || 3.5;
            const riskPerShare = Math.max(0.05, priceNum - Number(rawSL));
            const target1 = (priceNum + riskPerShare * 1.5).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const target2 = (priceNum + riskPerShare * 3.0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const adxVal = stock.adx_trend ? Number(stock.adx_trend).toFixed(1) : '24.5';

            return \`
              <!-- SUMMARY ROW -->
              <tr class="table-row-hover transition-colors group border-b border-slate-100 \${isHighConviction ? 'bg-amber-50/20' : ''}">
                <!-- Expand Chevron Toggle Cell -->
                <td class="px-3 sm:px-4 py-4 text-center">
                  <button 
                    onclick="toggleRowDetails('\${sym}')" 
                    class="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
                    title="Toggle trade details"
                  >
                    <svg id="chevron-\${sym}" class="w-4 h-4 transition-transform duration-300 \${isExpanded ? 'rotate-180 text-blue-600 font-bold' : ''}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </button>
                </td>
                
                <!-- Asset & Volume -->
                <td class="px-4 py-4">
                  <div class="flex items-center gap-2">
                    <button onclick="toggleRowDetails('\${sym}')" class="font-black text-slate-900 text-base hover:text-blue-600 transition-colors cursor-pointer">\${sym}</button>
                    \${convictionBadge}
                    <span class="px-2 py-0.5 rounded text-[10px] tracking-wider border \${rvolBadgeClass}">
                      \${rvolFlameSvg}RVOL \${rvolVal}x
                    </span>
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] font-black text-slate-400 tracking-wider uppercase">\${stock.sector || 'EQUITY'}</span>
                    <span class="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100">\${marginMult}x MTF</span>
                  </div>
                </td>

                <!-- LTP -->
                <td class="px-4 py-4 font-mono font-bold text-slate-900 text-base">
                  ₹\${priceNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>

                <!-- VWAP Ext. -->
                <td class="px-4 py-4 font-mono">
                  <div class="flex flex-col">
                    <span class="text-xs \${vwapDistClass}">
                      \${distVwap > 0 ? '+' : ''}\${distVwap}%
                    </span>
                    <span class="text-[9px] text-slate-400 font-medium tracking-wide uppercase">from VWAP</span>
                  </div>
                </td>

                <!-- MACD 15m -->
                <td class="px-4 py-4">
                  \${macdBadge}
                  <span class="ml-2 font-mono text-xs text-slate-400 font-bold">(\${stock.macd_value})</span>
                </td>

                <!-- RSI & ADX -->
                <td class="px-4 py-4">
                  <div class="flex flex-col">
                    <span class="font-mono text-xs \${rsiClass}">RSI: \${rsiVal}</span>
                    <span class="text-[10px] font-mono text-slate-400 font-medium">ADX: \${adxVal}</span>
                  </div>
                </td>

                <!-- Struct SL (ATR) -->
                <td class="px-4 py-3">
                  <div class="bg-white border border-slate-200 rounded-lg p-2 w-44 shadow-2xs">
                    <div class="flex justify-between items-center text-[10px] font-mono text-slate-400 border-b border-slate-100 pb-1 mb-1">
                      <span class="tracking-wider uppercase">Base LTP</span>
                      <span class="font-semibold text-slate-700">₹\${priceNum.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono text-slate-400 border-b border-slate-100 pb-1 mb-1">
                      <span class="tracking-wider uppercase" title="ATR: ₹\${atrVal}">
                        2 × ATR <span class="text-slate-400">(\${atrVal})</span>
                      </span>
                      <span class="font-semibold text-red-500">
                        - ₹\${(Number(atrVal) * 2).toFixed(2)}
                      </span>
                    </div>
                    <div class="flex justify-between items-center text-xs font-mono font-black pt-0.5">
                      <span class="text-slate-800 tracking-wider">STOP</span>
                      <span class="text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                        ₹\${formattedSL}
                      </span>
                    </div>
                  </div>
                </td>

                <!-- Actions -->
                <td class="px-4 py-4 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <a 
                      href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}" 
                      target="_blank" 
                      rel="noreferrer"
                      class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-700 text-slate-700 shadow-2xs transition-all"
                    >
                      Chart
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                      </svg>
                    </a>
                    <button
                      onclick="toggleRowDetails('\${sym}')"
                      class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                      title="Details"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>

              <!-- COLLAPSIBLE ACCORDION DETAIL ROW -->
              <tr id="detail-row-\${sym}" class="\${isExpanded ? '' : 'hidden'} bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-700">
                <td colSpan="8" class="p-4 sm:p-6">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                    
                    <!-- Panel 1: Quantitative Indicators Breakdown -->
                    <div class="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-3">
                      <div class="flex items-center justify-between border-b border-slate-700 pb-2">
                        <span class="font-extrabold uppercase tracking-wider text-slate-400 text-[10px]">Technical Matrix</span>
                        <span class="text-blue-400 font-mono font-bold">\${sym}</span>
                      </div>
                      <div class="space-y-2 font-mono">
                        <div class="flex justify-between items-center text-slate-300">
                          <span>15m MACD Value:</span>
                          <span class="font-bold text-white">\${stock.macd_value}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Signal Type:</span>
                          <span class="font-bold text-emerald-400">\${sig.label}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Relative Volume (RVOL):</span>
                          <span class="font-bold \${isHighRvol ? 'text-orange-400' : 'text-slate-200'}">\${rvolVal}x</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>RSI (14-Period):</span>
                          <span class="font-bold text-white">\${rsiVal}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>ADX Trend Strength:</span>
                          <span class="font-bold text-indigo-300">\${adxVal} (\${Number(adxVal) > 25 ? 'Strong' : 'Moderate'})</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 2: Trade Plan & ATR Risk Levels -->
                    <div class="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 space-y-3">
                      <div class="flex items-center justify-between border-b border-slate-700 pb-2">
                        <span class="font-extrabold uppercase tracking-wider text-slate-400 text-[10px]">MTF Risk & Targets</span>
                        <span class="text-emerald-400 font-mono font-bold">1:1.5 to 1:3 RR</span>
                      </div>
                      <div class="space-y-2 font-mono">
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Entry Price (LTP):</span>
                          <span class="font-bold text-white">₹\${priceNum.toFixed(2)}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Structural Stop (2x ATR):</span>
                          <span class="font-bold text-red-400">₹\${formattedSL}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Target 1 (1.5R):</span>
                          <span class="font-bold text-emerald-400">₹\${target1}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Target 2 (3.0R):</span>
                          <span class="font-bold text-emerald-300">₹\${target2}</span>
                        </div>
                        <div class="flex justify-between items-center text-slate-300">
                          <span>Risk per Share:</span>
                          <span class="font-bold text-amber-300">₹\${riskPerShare.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 3: Margin & Execution Actions -->
                    <div class="bg-slate-800/80 p-4 rounded-xl border border-slate-700/80 flex flex-col justify-between space-y-3">
                      <div>
                        <div class="flex items-center justify-between border-b border-slate-700 pb-2">
                          <span class="font-extrabold uppercase tracking-wider text-slate-400 text-[10px]">Execution & Margin</span>
                          <span class="text-purple-400 font-mono font-bold">\${marginMult}x Leverage</span>
                        </div>
                        <p class="text-slate-400 text-[11px] mt-2 leading-relaxed">
                          MTF Required Margin: <strong class="text-white font-mono">₹\${(priceNum / marginMult).toFixed(2)}</strong> / share. Always confirm 15m candle close before executing manual orders.
                        </p>
                      </div>

                      <div class="flex items-center gap-2 pt-2 border-t border-slate-700/60">
                        <button
                          onclick="copyTradePlan('\${sym}', \${priceNum}, \${Number(rawSL).toFixed(2)}, \${atrVal}, \${rvolVal})"
                          class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-xs cursor-pointer"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                          </svg>
                          Copy Plan
                        </button>
                        <a
                          href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}"
                          target="_blank"
                          rel="noreferrer"
                          class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs transition-all cursor-pointer"
                        >
                          Chart
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                          </svg>
                        </a>
                      </div>
                    </div>

                  </div>
                </td>
              </tr>
            \`;
          }).join('');
        }

        // On-Demand Manual Scan Trigger Function
        let isScanning = false;
        async function triggerManualScan() {
          if (isScanning) return;
          isScanning = true;
          const btn = document.getElementById('trigger-scan-btn');
          const btnText = document.getElementById('trigger-scan-text');
          const btnIcon = document.getElementById('trigger-scan-icon');
          
          if (btn) {
            btn.className = 'relative overflow-hidden group flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-xs font-black transition-all bg-blue-100 text-blue-500 border border-blue-200 cursor-not-allowed';
          }
          if (btnText) btnText.innerText = 'Scanning EC2...';
          if (btnIcon) {
            btnIcon.outerHTML = '<svg id="trigger-scan-icon" class="w-3.5 h-3.5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';
          }
          
          try {
            await fetch('/api/mtf-screener/trigger', { method: 'POST' });
            showToast('Scan requested on EC2');
          } catch (e) {
            console.error('Trigger request error:', e);
            showToast('Trigger failed', 'error');
          }

          let polls = 0;
          const pollInterval = setInterval(async () => {
            await fetchMTFSetups();
            polls++;
            if (polls >= 6) {
              clearInterval(pollInterval);
              resetScanButton();
            }
          }, 5000);
        }

        function resetScanButton() {
          isScanning = false;
          const btn = document.getElementById('trigger-scan-btn');
          const btnText = document.getElementById('trigger-scan-text');
          const btnIcon = document.getElementById('trigger-scan-icon');
          if (btn) {
            btn.className = 'relative overflow-hidden group flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-xs font-black transition-all bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-md hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-95 cursor-pointer border border-blue-400/20';
          }
          if (btnText) btnText.innerText = 'Run Scan';
          if (btnIcon) {
            btnIcon.outerHTML = '<svg id="trigger-scan-icon" class="w-3.5 h-3.5 text-blue-100 drop-shadow-xs group-hover:animate-pulse" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>';
          }
        }

        window.triggerManualScan = triggerManualScan;
        const btnElem = document.getElementById('trigger-scan-btn');
        if (btnElem) {
          btnElem.addEventListener('click', triggerManualScan);
        }

        // Live Cron Sync Countdown Timer (:01, :16, :31, :46 minutes)
        function updateLiveScanCountdown() {
          const now = new Date();
          const m = now.getMinutes();
          const targetMinutes = [1, 16, 31, 46];
          
          let targetM = targetMinutes.find(t => t > m);
          let nextScanDate = new Date(now);

          if (targetM !== undefined) {
            nextScanDate.setMinutes(targetM, 0, 0);
          } else {
            nextScanDate.setHours(now.getHours() + 1, 1, 0, 0);
          }

          const diffMs = nextScanDate.getTime() - now.getTime();
          const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));

          const mins = Math.floor(totalSeconds / 60);
          const secs = totalSeconds % 60;

          let timeString = '';
          if (mins > 0) {
            timeString = mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's';
          } else {
            timeString = secs + 's';
          }

          const labelElem = document.getElementById('countdown-label');
          if (labelElem) {
            labelElem.innerText = 'Next scan in: ' + timeString;
          }

          // Trigger setup fetch when cron fires
          if (totalSeconds === 0) {
            setTimeout(fetchMTFSetups, 3000);
          }
        }

        // Initialize Search Listener & Initial Data Fetch
        document.getElementById('search-input').addEventListener('input', applyFilter);
        fetchMTFSetups();

        // 60-Second Data Loop
        setInterval(fetchMTFSetups, 60000);

        // Live 1-Second Countdown Counter
        updateLiveScanCountdown();
        setInterval(updateLiveScanCountdown, 1000);
      ` }}></script>
    </body>
  </html>
);
