// cloud/src/routes/mtf-screener.tsx
import { jsx } from 'hono/jsx';

export const MTFScreenerPage = () => (
  <html lang="en" class="dark">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Quant MTF Terminal | TheFinalOption</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script dangerouslySetInnerHTML={{ __html: `
        tailwind.config = {
          darkMode: 'class',
          theme: {
            extend: {
              colors: {
                cyan: {
                  neon: '#00f2fe',
                  glow: '#4facfe',
                },
                emerald: {
                  neon: '#00e676',
                  dark: '#00a854',
                },
                crimson: {
                  neon: '#ff1744',
                  dark: '#b2102f',
                },
                amber: {
                  neon: '#ffb300',
                },
                terminal: {
                  void: '#06080d',
                  glass: 'rgba(10, 16, 26, 0.85)',
                  panel: 'rgba(15, 23, 42, 0.9)',
                  border: '#1e293b',
                  accent: '#334155',
                }
              },
              fontFamily: {
                mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
              }
            }
          }
        };
      ` }}></script>
      <style>{`
        :root {
          --color-cyan-neon: #00f2fe;
          --color-emerald-neon: #00e676;
          --color-crimson-neon: #ff1744;
          --color-amber-neon: #ffb300;
          --color-void: #06080d;
        }

        body { 
          background-color: var(--color-void); 
          color: #f8fafc; 
          font-family: 'JetBrains Mono', monospace; 
        }

        /* LIQUID GLASS RIGID TERMINAL PANELS */
        .terminal-glass-card {
          background: rgba(10, 16, 26, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255, 255, 255, 0.15);
          border-left: 1px solid rgba(255, 255, 255, 0.12);
          border-right: 1px solid rgba(0, 0, 0, 0.7);
          border-bottom: 1px solid rgba(0, 0, 0, 0.7);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .terminal-glass-header {
          background: rgba(6, 9, 15, 0.95);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-bottom: 1px solid rgba(0, 242, 254, 0.25);
        }

        .terminal-glass-panel {
          background: rgba(12, 19, 32, 0.9);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(0, 242, 254, 0.2);
          box-shadow: inset 0 0 20px rgba(0, 242, 254, 0.03);
        }

        .table-row-terminal {
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .table-row-terminal:hover { 
          background-color: rgba(0, 242, 254, 0.06) !important; 
          border-color: rgba(0, 242, 254, 0.4) !important;
        }

        /* CYBER SCANLINE & GLOW EFFECTS */
        .scanline {
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0, 242, 254, 0.04) 50%, rgba(0, 242, 254, 0.04));
          background-size: 100% 4px;
        }

        .cyan-glow {
          box-shadow: 0 0 15px rgba(0, 242, 254, 0.35);
        }
        .emerald-glow {
          box-shadow: 0 0 15px rgba(0, 230, 118, 0.35);
        }
        .crimson-glow {
          box-shadow: 0 0 15px rgba(255, 23, 68, 0.35);
        }

        .animate-fade-in {
          animation: fadeIn 0.15s cubic-bezier(0, 0, 0.2, 1);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Sharp Scrollbar */
        ::-webkit-scrollbar {
          height: 4px;
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: #06080d;
        }
        ::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 0px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #00f2fe;
        }
      `}</style>
    </head>
    <body class="min-h-screen bg-[#06080d] text-slate-100 font-mono antialiased relative overflow-x-hidden selection:bg-[#00f2fe] selection:text-[#06080d] scanline">
      
      {/* AMBIENT LIQUID REFRACTION SPHERES (CYBER CYAN & EMERALD) */}
      <div class="fixed top-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-[#00f2fe]/10 blur-[150px] pointer-events-none z-0"></div>
      <div class="fixed top-[50%] right-[-10%] w-[700px] h-[700px] rounded-full bg-[#00e676]/8 blur-[180px] pointer-events-none z-0"></div>

      {/* Toast Notification Container (Sharp Boxy) */}
      <div id="toast-container" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>

      {/* --- RIGID LIQUID GLASS TOP TERMINAL BAR --- */}
      <header class="sticky top-0 z-50 w-full bg-[#070b12]/90 backdrop-blur-2xl border-b border-[#00f2fe]/30 px-4 lg:px-6 py-2.5 flex justify-between items-center transition-all duration-200">

        {/* LEFT: Branding & Module ID */}
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 bg-[#00f2fe] cyan-glow inline-block"></span>
            <h1 class="text-sm font-black tracking-widest text-white uppercase font-mono">
              THEFINALOPTION<span class="text-[#00f2fe]">//</span>QUANT-RADAR
            </h1>
          </div>
          <span class="px-2 py-0.5 bg-[#00f2fe]/10 text-[#00f2fe] text-[10px] font-black tracking-widest border border-[#00f2fe]/40 uppercase">
            v4.2 PRO
          </span>
        </div>

        {/* CENTER: Navigation Tabs & Global Ticker */}
        <div class="hidden md:flex items-center gap-6">
          <nav class="flex border border-[#1e293b] bg-[#0c121e]">
            <a href="/" class="px-4 py-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors">
              TERMINAL
            </a>
            <a href="/mtf-screener" class="px-4 py-1.5 text-xs font-black text-[#06080d] bg-[#00f2fe] cyan-glow transition-colors">
              MTF RADAR
            </a>
          </nav>

          {/* Integrated Ticker Stats */}
          <div class="flex items-center gap-4 text-xs font-mono border-l border-r border-[#1e293b] px-4 py-1">
            <div class="flex items-center gap-2">
              <span class="text-slate-400 text-[10px] uppercase tracking-wider">SETUPS:</span>
              <span id="stat-total-setups" class="font-black text-white">0</span>
            </div>
            <span class="text-[#1e293b]">|</span>
            <div class="flex items-center gap-2">
              <span class="text-slate-400 text-[10px] uppercase tracking-wider">HIGH CONVICTION:</span>
              <span id="stat-high-conviction" class="font-black text-[#00f2fe]">0</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Telemetry & Manual Trigger Button */}
        <div class="flex items-center gap-4">
          {/* API Fuel Counter */}
          <div class="hidden sm:flex items-center gap-2.5 px-3 py-1 bg-[#0c121e] border border-[#1e293b] text-[10px]">
            <span class="text-slate-400 font-bold uppercase tracking-wider">FUEL:</span>
            <div class="w-12 h-1 bg-[#1e293b] overflow-hidden">
              <div class="h-full bg-[#00f2fe]" style="width: 95%"></div>
            </div>
            <span class="font-mono font-black text-slate-200">190/200</span>
          </div>

          {/* System Status Indicator */}
          <div class="flex items-center gap-2 border-l border-[#1e293b] pl-3">
            <span class="w-2 h-2 bg-[#00e676] emerald-glow"></span>
            <span class="text-xs font-black text-slate-200 uppercase tracking-wider">LIVE</span>
            <span id="countdown-label" class="text-[10px] font-bold text-slate-400 ml-1">
              [60s]
            </span>
          </div>

          {/* Manual Run Scan Trigger */}
          <button
            id="trigger-scan-btn"
            type="button"
            class="flex items-center gap-2 px-4 py-1.5 text-xs font-black text-[#06080d] bg-[#00f2fe] hover:bg-[#4facfe] cyan-glow transition-all active:translate-y-0.5 cursor-pointer uppercase tracking-wider"
          >
            <svg id="trigger-scan-icon" class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span id="trigger-scan-text">SCAN NOW</span>
          </button>
        </div>
      </header>

      {/* --- MAIN HIGH-DENSITY TERMINAL CONTAINER (NO HEAVY PADDING) --- */}
      <main class="w-full px-2 sm:px-4 py-4 space-y-4">

        {/* --- RIGID TERMINAL RADAR DATA MATRIX CARD --- */}
        <div class="terminal-glass-card border border-[#1e293b]">

          {/* TERMINAL HEADER & FILTER CONTROLS BAR */}
          <div class="terminal-glass-header px-4 py-3 flex flex-wrap items-center justify-between gap-4">
            
            {/* Left: Section Title & Live Setup Counter Badge */}
            <div class="flex items-center gap-3">
              <span class="w-2 h-2 bg-[#00f2fe] cyan-glow inline-block"></span>
              <h2 class="text-xs font-black tracking-widest text-white uppercase font-mono flex items-center gap-2">
                MULTIPLE TIMEFRAME CONFLUENCE MATRIX
              </h2>
              <span id="setup-count-badge" class="px-2 py-0.5 bg-[#00f2fe]/10 text-[#00f2fe] text-xs font-mono font-bold border border-[#00f2fe]/40">
                0 SETUPS
              </span>
            </div>

            {/* Center: Search & Filter Tabs */}
            <div class="flex flex-wrap items-center gap-3">
              {/* Search Box */}
              <div class="relative">
                <input
                  id="search-input"
                  type="text"
                  placeholder="FILTER TICKER / SECTOR..."
                  class="bg-[#06080d] border border-[#1e293b] focus:border-[#00f2fe] text-xs text-white px-3 py-1.5 w-52 focus:outline-none transition-colors uppercase font-mono placeholder:text-slate-500"
                />
              </div>

              {/* Boxy Rigid Filter Tabs */}
              <div class="flex items-center bg-[#06080d] border border-[#1e293b]">
                <button 
                  onclick="setFilterTab('ALL')" 
                  id="tab-ALL" 
                  class="px-3 py-1 text-xs font-black text-[#06080d] bg-[#00f2fe] transition-colors cursor-pointer uppercase"
                >
                  ALL
                </button>
                <button 
                  onclick="setFilterTab('HIGH')" 
                  id="tab-HIGH" 
                  class="px-3 py-1 text-xs font-bold text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors cursor-pointer uppercase border-l border-[#1e293b]"
                >
                  ⚡ HIGH CONVICTION
                </button>
                <button 
                  onclick="setFilterTab('ZERO_CROSS')" 
                  id="tab-ZERO_CROSS" 
                  class="px-3 py-1 text-xs font-bold text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors cursor-pointer uppercase border-l border-[#1e293b]"
                >
                  🎯 ZERO CROSS
                </button>
                <button 
                  onclick="setFilterTab('HIGH_RVOL')" 
                  id="tab-HIGH_RVOL" 
                  class="px-3 py-1 text-xs font-bold text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors cursor-pointer uppercase border-l border-[#1e293b]"
                >
                  🔥 HIGH RVOL
                </button>
              </div>
            </div>

            {/* Right: Expand & Table Collapse Controls */}
            <div class="flex items-center gap-2">
              <button
                id="toggle-all-rows-btn"
                onclick="toggleExpandAllRows()"
                class="px-3 py-1 bg-[#0c121e] hover:bg-[#1e293b] text-slate-300 text-xs font-bold border border-[#1e293b] transition-colors cursor-pointer uppercase"
              >
                <span id="toggle-all-rows-text">EXPAND ALL</span>
              </button>

              <button
                id="table-collapse-btn"
                onclick="toggleTableCollapse()"
                class="px-3 py-1 bg-[#0c121e] hover:bg-[#00f2fe] hover:text-[#06080d] text-[#00f2fe] text-xs font-black border border-[#00f2fe]/40 transition-colors cursor-pointer uppercase"
              >
                <span id="table-collapse-text">COLLAPSE TABLE</span>
              </button>
            </div>
          </div>

          {/* COLLAPSED SUMMARY TICKER TAPE (When Table Collapsed) */}
          <div id="table-collapsed-summary" class="hidden bg-[#070b12] text-slate-200 px-4 py-2 border-b border-[#1e293b] flex items-center justify-between text-xs font-mono">
            <div class="flex items-center gap-3 overflow-x-auto py-0.5">
              <span class="text-slate-500 font-bold uppercase tracking-wider shrink-0 text-[10px]">COLLAPSED TICKERS:</span>
              <div id="collapsed-tickers-list" class="flex items-center gap-2 shrink-0">
                {/* Dynamically populated */}
              </div>
            </div>
            <button 
              onclick="toggleTableCollapse()"
              class="text-[#00f2fe] hover:underline font-bold shrink-0 ml-4 cursor-pointer uppercase text-xs"
            >
              [EXPAND]
            </button>
          </div>

          {/* TERMINAL TABLE MATRIX WRAPPER */}
          <div id="screener-table-container" class="overflow-x-auto transition-all duration-200 max-h-[2500px]">
            <table class="w-full text-left text-xs whitespace-nowrap border-collapse">
              <thead class="bg-[#06080d] border-b border-[#1e293b] uppercase text-[10px] font-black text-slate-400 tracking-wider">
                <tr>
                  <th class="px-3 py-2.5 text-center w-8 border-r border-[#1e293b]"></th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">ASSET & RVOL</th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">LTP</th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">VWAP DEV %</th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">MACD SIGNAL (15M)</th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">RSI / ADX</th>
                  <th class="px-4 py-2.5 border-r border-[#1e293b]">ATR STOP LOSS</th>
                  <th class="px-4 py-2.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody id="screener-table-body" class="divide-y divide-[#1e293b]/60">
                <tr>
                  <td colSpan={8} class="px-6 py-16 text-center text-slate-500">
                    <div class="flex flex-col items-center justify-center gap-3">
                      <div class="w-6 h-6 border-2 border-[#00f2fe] border-t-transparent animate-spin"></div>
                      <span class="font-bold text-xs uppercase tracking-widest text-[#00f2fe]">SCANNING LIVE MARKET MATRIX...</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </main>

      {/* Client-Side Logic */}
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
                btn.className = 'px-3 py-1 text-xs font-black text-[#06080d] bg-[#00f2fe] cyan-glow transition-colors cursor-pointer uppercase';
              } else {
                btn.className = 'px-3 py-1 text-xs font-bold text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors cursor-pointer uppercase border-l border-[#1e293b]';
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
          if (badgeElem) badgeElem.innerText = stocks.length + ' SETUPS';
        }

        function toggleTableCollapse() {
          isTableCollapsed = !isTableCollapsed;
          const container = document.getElementById('screener-table-container');
          const summary = document.getElementById('table-collapsed-summary');
          const btnText = document.getElementById('table-collapse-text');

          if (isTableCollapsed) {
            if (container) {
              container.style.maxHeight = '0px';
              container.style.opacity = '0';
              setTimeout(() => { container.classList.add('hidden'); }, 200);
            }
            if (summary) summary.classList.remove('hidden');
            if (btnText) btnText.innerText = 'EXPAND TABLE';
          } else {
            if (container) {
              container.classList.remove('hidden');
              requestAnimationFrame(() => {
                container.style.maxHeight = '2500px';
                container.style.opacity = '1';
              });
            }
            if (summary) summary.classList.add('hidden');
            if (btnText) btnText.innerText = 'COLLAPSE TABLE';
          }
        }

        function updateCollapsedSummary(stocks) {
          const listElem = document.getElementById('collapsed-tickers-list');
          if (!listElem) return;
          if (stocks.length === 0) {
            listElem.innerHTML = '<span class="text-slate-500">[NO SETUPS]</span>';
            return;
          }
          listElem.innerHTML = stocks.slice(0, 10).map(s => \`
            <span class="px-2 py-0.5 bg-[#0c121e] border border-[#1e293b] text-slate-200 font-bold text-[11px] flex items-center gap-1.5">
              \${s.tradingsymbol}
              <span class="text-[10px] text-[#00f2fe] font-mono font-black">₹\${Number(s.current_price).toFixed(1)}</span>
            </span>
          \`).join('') + (stocks.length > 10 ? \`<span class="text-slate-500 text-[10px] font-bold">+\${stocks.length - 10} MORE</span>\` : '');
        }

        function toggleRowDetails(symbol) {
          const detailRow = document.getElementById('detail-row-' + symbol);
          const chev = document.getElementById('chevron-' + symbol);
          if (!detailRow) return;

          if (expandedRows.has(symbol)) {
            expandedRows.delete(symbol);
            detailRow.classList.add('hidden');
            if (chev) chev.innerText = '+';
          } else {
            expandedRows.add(symbol);
            detailRow.classList.remove('hidden');
            if (chev) chev.innerText = '−';
          }
        }

        function toggleExpandAllRows() {
          const allSymbols = allStocks.map(s => s.tradingsymbol);
          const btnText = document.getElementById('toggle-all-rows-text');

          if (expandedRows.size === allSymbols.length && allSymbols.length > 0) {
            expandedRows.clear();
            allSymbols.forEach(sym => {
              const row = document.getElementById('detail-row-' + sym);
              const chev = document.getElementById('chevron-' + sym);
              if (row) row.classList.add('hidden');
              if (chev) chev.innerText = '+';
            });
            if (btnText) btnText.innerText = 'EXPAND ALL';
          } else {
            allSymbols.forEach(sym => {
              expandedRows.add(sym);
              const row = document.getElementById('detail-row-' + sym);
              const chev = document.getElementById('chevron-' + sym);
              if (row) row.classList.remove('hidden');
              if (chev) chev.innerText = '−';
            });
            if (btnText) btnText.innerText = 'COLLAPSE ALL';
          }
        }

        function showToast(message, type = 'success') {
          const container = document.getElementById('toast-container');
          if (!container) return;
          const toast = document.createElement('div');
          toast.className = 'pointer-events-auto px-4 py-2 border text-xs font-black flex items-center gap-2 bg-[#0c121e] text-white border-[#00f2fe] cyan-glow uppercase tracking-wider';
          toast.innerHTML = \`
            <span class="w-1.5 h-1.5 bg-[#00f2fe]"></span>
            <span>\${message}</span>
          \`;
          container.appendChild(toast);
          setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
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
              showToast('COPIED ' + symbol + ' TRADE PLAN');
            }).catch(() => {
              showToast('COPY FAILED', 'error');
            });
          } else {
            showToast('COPIED ' + symbol + ' PLAN');
          }
        }

        function renderTable(stocks) {
          const tbody = document.getElementById('screener-table-body');
          if (!stocks || stocks.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="8" class="px-6 py-16 text-center text-slate-500">
                  <p class="text-slate-300 font-black text-sm uppercase tracking-widest">[ NO ACTIVE MTF SETUPS MATCHING CRITERIA ]</p>
                  <p class="text-xs text-slate-500 mt-1 uppercase font-mono">CONTINUOUS 15M / 3H UPSTOX CANDLE SCANNER RUNNING...</p>
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
            'ZERO_LINE_CROSS':    { label: 'ZERO CROSS', bg: 'bg-[#00e676]/15 text-[#00e676] border-[#00e676]/60' },
            'SIGNAL_LINE_CROSS':  { label: 'SIGNAL CROSS', bg: 'bg-[#00f2fe]/15 text-[#00f2fe] border-[#00f2fe]/60' },
            'APPROACHING_ZERO':   { label: 'APPROACHING ZERO', bg: 'bg-slate-800 text-slate-300 border-slate-600' },
            'EMA_GOLDEN_CROSS':   { label: 'EMA GOLDEN CROSS', bg: 'bg-[#00e676]/20 text-[#00e676] border-[#00e676]' },
            'BULLISH_ENGULFING':  { label: 'BULLISH ENGULF', bg: 'bg-[#00e676]/15 text-[#00e676] border-[#00e676]/50' },
            'HAMMER':             { label: 'HAMMER', bg: 'bg-[#00e676]/15 text-[#00e676] border-[#00e676]/50' },
            'RSI_REVERSAL':       { label: 'RSI REVERSAL', bg: 'bg-[#00f2fe]/15 text-[#00f2fe] border-[#00f2fe]/50' },
            'RSI_50_CROSS':       { label: 'RSI 50 CROSS', bg: 'bg-[#00f2fe]/15 text-[#00f2fe] border-[#00f2fe]/50' },
            'BULLISH_MOMENTUM':   { label: 'BULLISH', bg: 'bg-[#00e676]/15 text-[#00e676] border-[#00e676]/50' },
          };

          tbody.innerHTML = sorted.map(stock => {
            const sym = stock.tradingsymbol;
            const isExpanded = expandedRows.has(sym);

            const sig = signalMap[stock.macd_signal] || signalMap['BULLISH_MOMENTUM'];
            const macdBadge = \`<span class="px-2 py-0.5 text-[10px] font-black tracking-wider uppercase border \${sig.bg}">
                \${sig.label}
              </span>\`;

            const rsiVal = Number(stock.rsi_14 || 50);
            const rsiClass = rsiVal > 60 ? 'text-[#00e676] font-black' : (rsiVal < 40 ? 'text-[#ff1744] font-black' : 'text-slate-400 font-bold');
            
            const rvolVal = Number(stock.rvol || 1.0);
            const isHighRvol = rvolVal > 2.5;
            const rvolBadgeClass = isHighRvol
              ? 'bg-[#ffb300]/20 text-[#ffb300] border-[#ffb300]/60 font-black'
              : 'bg-[#0c121e] text-slate-400 border-[#1e293b] font-bold';

            const distVwap = Number(stock.distance_from_vwap_pct || 0);
            const vwapDistClass = distVwap > 2.0
              ? 'text-[#ffb300] font-black'
              : (distVwap < 0 ? 'text-[#ff1744] font-black' : 'text-[#00e676] font-black');

            const priceNum = Number(stock.current_price || 0);
            const atrVal = Number(stock.atr_value || (priceNum * 0.015)).toFixed(2);
            const rawSL = stock.suggested_sl || (priceNum - Number(atrVal) * 2);
            const formattedSL = Number(rawSL).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });

            const isHighConviction = stock.conviction === 'HIGH';
            const convictionBadge = isHighConviction
              ? \`<span class="px-1.5 py-0.5 text-[9px] font-black tracking-widest bg-[#00f2fe] text-[#06080d] uppercase cyan-glow">
                  HIGH
                </span>\`
              : \`<span class="px-1.5 py-0.5 text-[9px] font-bold tracking-widest bg-[#0c121e] text-slate-400 border border-[#1e293b] uppercase">
                  15M
                </span>\`;

            const marginMult = stock.mtf_margin_multiplier || 3.5;
            const riskPerShare = Math.max(0.05, priceNum - Number(rawSL));
            const target1 = (priceNum + riskPerShare * 1.5).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const target2 = (priceNum + riskPerShare * 3.0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const adxVal = stock.adx_trend ? Number(stock.adx_trend).toFixed(1) : '24.5';

            return \`
              <!-- SUMMARY ROW (BOX & RIGID GLASS) -->
              <tr class="table-row-terminal transition-all border-b border-[#1e293b] \${isHighConviction ? 'bg-[#00f2fe]/5' : 'bg-[#0a101a]/70'}">
                <!-- Expand Toggle -->
                <td class="px-3 py-3 text-center border-r border-[#1e293b]">
                  <button 
                    onclick="toggleRowDetails('\${sym}')" 
                    id="chevron-\${sym}"
                    class="w-5 h-5 flex items-center justify-center text-[#00f2fe] hover:bg-[#00f2fe]/20 font-mono font-black text-sm border border-[#00f2fe]/30 cursor-pointer transition-colors"
                  >
                    \${isExpanded ? '−' : '+'}
                  </button>
                </td>
                
                <!-- Asset & Volume -->
                <td class="px-4 py-3 border-r border-[#1e293b]">
                  <div class="flex items-center gap-2">
                    <button onclick="toggleRowDetails('\${sym}')" class="font-black text-white text-sm hover:text-[#00f2fe] transition-colors cursor-pointer uppercase">\${sym}</button>
                    \${convictionBadge}
                    <span class="px-1.5 py-0.5 text-[9px] tracking-wider border \${rvolBadgeClass}">
                      RVOL \${rvolVal}x
                    </span>
                  </div>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-[9px] font-bold text-slate-400 tracking-wider uppercase">\${stock.sector || 'EQUITY'}</span>
                    <span class="text-[9px] font-black text-[#00f2fe] bg-[#00f2fe]/10 px-1 py-0.1 border border-[#00f2fe]/30">\${marginMult}X MTF</span>
                  </div>
                </td>

                <!-- LTP -->
                <td class="px-4 py-3 font-mono font-black text-white text-sm border-r border-[#1e293b]">
                  ₹\${priceNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>

                <!-- VWAP Dev. -->
                <td class="px-4 py-3 font-mono border-r border-[#1e293b]">
                  <div class="flex flex-col">
                    <span class="text-xs \${vwapDistClass}">
                      \${distVwap > 0 ? '+' : ''}\${distVwap}%
                    </span>
                    <span class="text-[9px] text-slate-500 font-bold tracking-wide uppercase">VWAP DEV</span>
                  </div>
                </td>

                <!-- MACD 15m -->
                <td class="px-4 py-3 border-r border-[#1e293b]">
                  \${macdBadge}
                  <span class="ml-2 font-mono text-xs text-slate-400 font-bold">(\${stock.macd_value})</span>
                </td>

                <!-- RSI / ADX -->
                <td class="px-4 py-3 border-r border-[#1e293b]">
                  <div class="flex flex-col font-mono text-xs">
                    <span class="\${rsiClass}">RSI: \${rsiVal}</span>
                    <span class="text-[10px] text-slate-400 font-bold">ADX: \${adxVal}</span>
                  </div>
                </td>

                <!-- Struct SL (ATR) -->
                <td class="px-4 py-2 border-r border-[#1e293b]">
                  <div class="bg-[#06080d] border border-[#ff1744]/40 p-2 w-44">
                    <div class="flex justify-between items-center text-[9px] font-mono text-slate-400 pb-0.5 border-b border-[#1e293b]">
                      <span class="uppercase">BASE LTP</span>
                      <span class="font-black text-slate-200">₹\${priceNum.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-[9px] font-mono text-slate-400 py-0.5 border-b border-[#1e293b]">
                      <span>2x ATR (\${atrVal})</span>
                      <span class="font-black text-[#ff1744]">-₹\${(Number(atrVal) * 2).toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs font-mono font-black pt-1">
                      <span class="text-slate-300">STOP</span>
                      <span class="text-[#ff1744] bg-[#ff1744]/10 px-1 py-0.5 border border-[#ff1744]/40">
                        ₹\${formattedSL}
                      </span>
                    </div>
                  </div>
                </td>

                <!-- Actions -->
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <a 
                      href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}" 
                      target="_blank" 
                      rel="noreferrer"
                      class="px-2.5 py-1 text-xs font-black bg-[#0c121e] hover:bg-[#00f2fe] hover:text-[#06080d] text-slate-200 border border-[#1e293b] hover:border-[#00f2fe] transition-all uppercase"
                    >
                      CHART ↗
                    </a>
                    <button
                      onclick="toggleRowDetails('\${sym}')"
                      class="px-2 py-1 bg-[#0c121e] hover:bg-[#1e293b] text-[#00f2fe] border border-[#1e293b] transition-colors cursor-pointer text-xs font-bold"
                      title="Trade Details Matrix"
                    >
                      DETAILS
                    </button>
                  </div>
                </td>
              </tr>

              <!-- EXPANDABLE ACCORDION DETAIL ROW (RIGID GLASS TERMINAL DRAWER) -->
              <tr id="detail-row-\${sym}" class="\${isExpanded ? '' : 'hidden'} bg-[#070c14] border-b border-[#00f2fe]/40">
                <td colSpan="8" class="p-4 sm:p-5">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                    
                    <!-- Panel 1: Technical Matrix -->
                    <div class="terminal-glass-panel p-3.5 space-y-2">
                      <div class="flex items-center justify-between border-b border-[#1e293b] pb-1.5">
                        <span class="font-black uppercase tracking-wider text-slate-400 text-[10px]">TECHNICAL MATRIX</span>
                        <span class="text-[#00f2fe] font-black">\${sym}</span>
                      </div>
                      <div class="space-y-1 text-[11px]">
                        <div class="flex justify-between text-slate-300">
                          <span>15m MACD Histogram:</span>
                          <span class="font-black text-white">\${stock.macd_value}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>Signal Confluence:</span>
                          <span class="font-black text-[#00e676]">\${sig.label}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>RVOL Multiplier:</span>
                          <span class="font-black \${isHighRvol ? 'text-[#ffb300]' : 'text-white'}>\${rvolVal}x</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>RSI Oscillator:</span>
                          <span class="font-black text-white">\${rsiVal}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>ADX Trend Vector:</span>
                          <span class="font-black text-[#00f2fe]">\${adxVal}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 2: Risk & Targets -->
                    <div class="terminal-glass-panel p-3.5 space-y-2">
                      <div class="flex items-center justify-between border-b border-[#1e293b] pb-1.5">
                        <span class="font-black uppercase tracking-wider text-slate-400 text-[10px]">QUANT RISK & TARGETS</span>
                        <span class="text-[#00e676] font-black">1:1.5 TO 1:3 RR</span>
                      </div>
                      <div class="space-y-1 text-[11px]">
                        <div class="flex justify-between text-slate-300">
                          <span>Execution LTP:</span>
                          <span class="font-black text-white">₹\${priceNum.toFixed(2)}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>ATR Stop Loss (2x):</span>
                          <span class="font-black text-[#ff1744]">₹\${formattedSL}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>Target 1 (1.5R):</span>
                          <span class="font-black text-[#00e676]">₹\${target1}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>Target 2 (3.0R):</span>
                          <span class="font-black text-[#00e676]">₹\${target2}</span>
                        </div>
                        <div class="flex justify-between text-slate-300">
                          <span>Risk Delta / Share:</span>
                          <span class="font-black text-[#00f2fe]">₹\${riskPerShare.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 3: Execution & Copy Plan -->
                    <div class="terminal-glass-panel p-3.5 flex flex-col justify-between space-y-2">
                      <div>
                        <div class="flex items-center justify-between border-b border-[#1e293b] pb-1.5">
                          <span class="font-black uppercase tracking-wider text-slate-400 text-[10px]">MARGIN & EXECUTION</span>
                          <span class="text-[#00f2fe] font-black">\${marginMult}X MARGIN</span>
                        </div>
                        <p class="text-slate-400 text-[10px] mt-2 leading-relaxed uppercase">
                          REQUIRED MTF MARGIN: <strong class="text-white font-mono">₹\${(priceNum / marginMult).toFixed(2)}</strong> / SHARE.
                        </p>
                      </div>

                      <div class="flex items-center gap-2 pt-2 border-t border-[#1e293b]">
                        <button
                          onclick="copyTradePlan('\${sym}', \${priceNum}, \${Number(rawSL).toFixed(2)}, \${atrVal}, \${rvolVal})"
                          class="flex-1 py-1.5 text-xs font-black bg-[#00f2fe] hover:bg-[#4facfe] text-[#06080d] cyan-glow uppercase transition-all cursor-pointer"
                        >
                          COPY TRADE PLAN
                        </button>
                        <a
                          href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}"
                          target="_blank"
                          rel="noreferrer"
                          class="px-3 py-1.5 text-xs font-black bg-[#0c121e] hover:bg-[#1e293b] text-slate-200 border border-[#1e293b] uppercase transition-colors"
                        >
                          CHART
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
            btn.className = 'flex items-center gap-2 px-4 py-1.5 text-xs font-black text-slate-400 bg-[#0c121e] border border-[#1e293b] cursor-not-allowed uppercase';
          }
          if (btnText) btnText.innerText = 'SCANNING...';
          
          try {
            await fetch('/api/mtf-screener/trigger', { method: 'POST' });
            showToast('SCAN TRIGGERED ON EC2');
          } catch (e) {
            console.error('Trigger request error:', e);
            showToast('TRIGGER FAILED', 'error');
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
          if (btn) {
            btn.className = 'flex items-center gap-2 px-4 py-1.5 text-xs font-black text-[#06080d] bg-[#00f2fe] hover:bg-[#4facfe] cyan-glow transition-all active:translate-y-0.5 cursor-pointer uppercase tracking-wider';
          }
          if (btnText) btnText.innerText = 'SCAN NOW';
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
            timeString = mins + 'M ' + (secs < 10 ? '0' : '') + secs + 'S';
          } else {
            timeString = secs + 'S';
          }

          const labelElem = document.getElementById('countdown-label');
          if (labelElem) {
            labelElem.innerText = '[' + timeString + ']';
          }

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
