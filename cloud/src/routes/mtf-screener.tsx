// cloud/src/routes/mtf-screener.tsx
import { jsx } from 'hono/jsx';

export const MTFScreenerPage = () => (
  <html lang="en" class="light">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Quant MTF Terminal | TheFinalOption</title>
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

      {/* GOOGLE FONTS: INTER (UI) + JETBRAINS MONO (NUMERIC/QUANT) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <script src="https://cdn.tailwindcss.com"></script>
      <script dangerouslySetInnerHTML={{
        __html: `
        tailwind.config = {
          darkMode: 'class',
          theme: {
            extend: {
              colors: {
                snow: '#f8f9fa',
                platinum: '#e9ecef',
                alabaster: '#dee2e6',
                paleslate: '#ced4da',
                paleslate2: '#adb5bd',
                slategrey: '#6c757d',
                irongrey: '#495057',
                gunmetal: '#343a40',
                carbon: '#212529',
                
                // Trend & Indicator Highlights
                emerald: {
                  DEFAULT: '#10b981',
                  dark: '#047857',
                  light: '#ecfdf5',
                  border: '#a7f3d0',
                },
                crimson: {
                  DEFAULT: '#ef4444',
                  dark: '#b91c1c',
                  light: '#fef2f2',
                  border: '#fca5a5',
                },
                amber: {
                  DEFAULT: '#f59e0b',
                  dark: '#b45309',
                  light: '#fffbeb',
                  border: '#fde68a',
                }
              },
              fontFamily: {
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
              }
            }
          }
        };
      ` }}></script>
      <style>{`
        :root {
          --bright-snow: #f8f9fa;
          --platinum: #e9ecef;
          --alabaster-grey: #dee2e6;
          --pale-slate: #ced4da;
          --pale-slate-2: #adb5bd;
          --slate-grey: #6c757d;
          --iron-grey: #495057;
          --gunmetal: #343a40;
          --carbon-black: #212529;
        }

        body { 
          background-color: var(--bright-snow); 
          color: var(--carbon-black); 
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.5;
        }

        html {
          scroll-behavior: smooth;
        }

        /* TABULAR NUMERICS FOR QUANT DATA */
        .font-mono {
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
        }

        /* LIQUID GLASS RIGID LIGHT TERMINAL PANELS */
        .terminal-glass-card-light {
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255, 255, 255, 0.95);
          border-left: 1px solid rgba(255, 255, 255, 0.95);
          border-right: 1px solid var(--alabaster-grey);
          border-bottom: 1px solid var(--alabaster-grey);
          box-shadow: 0 16px 40px rgba(33, 37, 41, 0.04), inset 0 1px 0 rgba(255, 255, 255, 1);
        }

        .terminal-glass-header-light {
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-bottom: 1px solid var(--alabaster-grey);
        }

        .terminal-glass-panel-dark {
          background: var(--carbon-black);
          border: 1px solid var(--gunmetal);
          box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.4);
        }

        .table-row-terminal-light {
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .table-row-terminal-light:hover { 
          background-color: var(--platinum) !important; 
          border-color: var(--pale-slate) !important;
        }

        .animate-fade-in {
          animation: fadeIn 0.15s cubic-bezier(0, 0, 0.2, 1);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Sharp Scrollbar Light */
        ::-webkit-scrollbar {
          height: 5px;
          width: 5px;
        }
        ::-webkit-scrollbar-track {
          background: var(--bright-snow);
        }
        ::-webkit-scrollbar-thumb {
          background: var(--pale-slate);
          border-radius: 0px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--slate-grey);
        }
      `}</style>
    </head>
    <body class="min-h-screen bg-snow text-carbon font-sans antialiased relative overflow-x-hidden selection:bg-carbon selection:text-snow">

      {/* Toast Notification Container (Sharp Boxy Light) */}
      <div id="toast-container" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>

      {/* --- RIGID LIQUID GLASS TOP LIGHT TERMINAL BAR --- */}
      <header class="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-2xl border-b border-alabaster px-4 lg:px-6 py-2.5 flex justify-between items-center transition-all duration-200 shadow-xs">

        {/* LEFT: Branding & Module ID */}
        <div class="flex items-center gap-3.5">
          <div class="flex items-center gap-2">
            <img src="/favicon.svg" alt="TheFinalOption Logo" class="w-7 h-7 shadow-sm" />
            <h1 class="text-sm font-extrabold tracking-tight text-carbon uppercase font-sans">
              MTF-RADAR
            </h1>
          </div>
        </div>

        {/* CENTER: Integrated Ticker Stats */}
        <div class="hidden md:flex items-center gap-6">
          <div class="flex items-center gap-4 text-xs border-l border-r border-alabaster px-4 py-1">
            <div class="flex items-center gap-2">
              <span class="text-slategrey text-[10px] font-semibold uppercase tracking-wider">SETUPS:</span>
              <span id="stat-total-setups" class="font-mono font-extrabold text-carbon">0</span>
            </div>
            <span class="text-alabaster">|</span>
            <div class="flex items-center gap-2">
              <span class="text-slategrey text-[10px] font-semibold uppercase tracking-wider">POSITIONS:</span>
              <span id="stat-portfolio-count" class="font-mono font-extrabold text-carbon">0</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Telemetry & Manual Trigger Button */}
        <div class="flex items-center gap-4">
          {/* API Fuel Counter */}
          <div class="hidden sm:flex items-center gap-2.5 px-3 py-1 bg-platinum border border-alabaster text-[10px]">
            <span class="text-slategrey font-bold uppercase tracking-wider">FUEL:</span>
            <div class="w-12 h-1 bg-alabaster overflow-hidden">
              <div class="h-full bg-emerald" style="width: 95%"></div>
            </div>
            <span class="font-mono font-bold text-gunmetal">190/200</span>
          </div>

          {/* System Status Indicator */}
          <div class="flex items-center gap-2 border-l border-alabaster pl-3">
            <span class="w-2 h-2 bg-emerald"></span>
            <span class="text-xs font-extrabold text-carbon uppercase tracking-wider">LIVE</span>
            <span id="countdown-label" class="text-[10px] font-mono font-bold text-slategrey ml-0.5">
              [60s]
            </span>
          </div>

          {/* Manual Run Scan Trigger */}
          <button
            id="trigger-scan-btn"
            type="button"
            class="flex items-center gap-2 px-4 py-1.5 text-xs font-extrabold text-snow bg-carbon hover:bg-gunmetal transition-all active:translate-y-0.5 cursor-pointer uppercase tracking-wider"
          >
            <svg id="trigger-scan-icon" class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span id="trigger-scan-text">SCAN NOW</span>
          </button>
        </div>
      </header>

      {/* --- MAIN UNIFIED HIGH-DENSITY QUANT DASHBOARD CONTAINER --- */}
      <main class="w-full px-2 sm:px-4 py-4 space-y-6">

        {/* ============================================================ */}
        {/* SECTION 1: QUANT MTF SCREENER RADAR MATRIX */}
        {/* ============================================================ */}
        <section id="screener-section" class="terminal-glass-card-light border border-alabaster">

          {/* TERMINAL HEADER & FILTER CONTROLS BAR */}
          <div class="terminal-glass-header-light px-4 py-3 flex flex-wrap items-center justify-between gap-4">

            {/* Left: Section Title & Live Setup Counter Badge */}
            <div class="flex items-center gap-3">
              <svg class="w-3.5 h-3.5 text-carbon shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="6"></circle>
                <circle cx="12" cy="12" r="2"></circle>
              </svg>
              <h2 class="text-xs font-extrabold tracking-wider text-carbon uppercase font-sans flex items-center gap-2">
                ACTIVE TRADE SETUPS
              </h2>
              <span id="setup-count-badge" class="px-2 py-0.5 bg-platinum text-carbon text-xs font-mono font-bold border border-alabaster">
                0 SETUPS
              </span>
            </div>

            {/* Center: Search Box */}
            <div class="relative">
              <input
                id="search-input"
                type="text"
                placeholder="Filter ticker / sector..."
                class="w-56 px-3 py-1.5 bg-snow border border-alabaster text-carbon text-xs font-mono placeholder:text-paleslate focus:outline-none focus:border-carbon transition-colors"
                oninput="handleSearch(event)"
              />
              <svg class="w-3.5 h-3.5 text-paleslate absolute right-2.5 top-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>

            {/* Right: Expand & Table Collapse Controls */}
            <div class="flex items-center gap-2">
              <button
                id="toggle-all-rows-btn"
                onclick="toggleExpandAllRows()"
                class="px-3 py-1.5 bg-platinum hover:bg-paleslate text-gunmetal text-xs font-bold border border-alabaster transition-colors cursor-pointer uppercase tracking-wider"
              >
                <span id="toggle-all-rows-text">EXPAND ALL</span>
              </button>

              <button
                id="table-collapse-btn"
                onclick="toggleTableCollapse()"
                class="px-3 py-1.5 bg-snow hover:bg-carbon hover:text-snow text-carbon text-xs font-extrabold border border-alabaster transition-colors cursor-pointer uppercase tracking-wider"
              >
                <span id="table-collapse-text">COLLAPSE TABLE</span>
              </button>
            </div>
          </div>

          {/* COLLAPSED SUMMARY TICKER TAPE (HIDDEN WHEN EXPANDED) */}
          <div id="table-collapsed-summary" class="hidden bg-platinum text-carbon px-4 py-2 border-b border-alabaster flex items-center justify-between text-xs">
            <div class="flex items-center gap-3 overflow-x-auto py-0.5">
              <span class="text-slategrey font-bold uppercase tracking-wider shrink-0 text-[10px]">COLLAPSED TICKERS:</span>
              <div id="collapsed-tickers-list" class="flex items-center gap-2 shrink-0">
                {/* Dynamically populated */}
              </div>
            </div>
            <button
              onclick="toggleTableCollapse()"
              class="text-carbon hover:underline font-bold shrink-0 ml-4 cursor-pointer uppercase text-xs tracking-wider font-mono"
            >
              [EXPAND]
            </button>
          </div>

          {/* TERMINAL TABLE MATRIX WRAPPER (EXPANDED BY DEFAULT) */}
          <div id="screener-table-container" class="overflow-x-auto transition-all duration-200 opacity-100 max-h-[2500px]">
            <table class="w-full text-left text-xs whitespace-nowrap border-collapse">
              <thead class="bg-platinum border-b border-alabaster uppercase text-[10px] font-extrabold text-gunmetal tracking-wider">
                <tr>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('asset')">
                    <div class="flex items-center justify-between">ASSET & RVOL <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="asset"></span></div>
                  </th>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('ltp')">
                    <div class="flex items-center justify-between">LTP <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="ltp"></span></div>
                  </th>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('vwap')">
                    <div class="flex items-center justify-between">VWAP DEV % <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="vwap"></span></div>
                  </th>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('macd')">
                    <div class="flex items-center justify-between">MACD SIGNAL (30M) <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="macd"></span></div>
                  </th>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('rsi')">
                    <div class="flex items-center justify-between">RSI / ADX <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="rsi"></span></div>
                  </th>
                  <th class="px-4 py-3 border-r border-alabaster cursor-pointer hover:bg-snow select-none group" onclick="sortScreenerTable('atr')">
                    <div class="flex items-center justify-between">ATR STOP LOSS <span class="sort-icon text-paleslate group-hover:text-irongrey transition-colors" data-col="atr"></span></div>
                  </th>
                  <th class="px-4 py-3 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody id="screener-table-body" class="divide-y divide-platinum">
                <tr>
                  <td colSpan={8} class="px-6 py-16 text-center text-slategrey">
                    <div class="flex flex-col items-center justify-center gap-3">
                      <div class="w-6 h-6 border-2 border-carbon border-t-transparent animate-spin"></div>
                      <span class="font-bold text-xs uppercase tracking-widest text-carbon">SCANNING LIVE MARKET MATRIX...</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </section>

        {/* ============================================================ */}
        {/* LOWER SECTION: FLEX LAYOUT FOR PORTFOLIO AND BRIEFING        */}
        {/* ============================================================ */}
        <div class="flex flex-col lg:flex-row gap-4 items-start w-full">

          {/* SECTION 2: ACTIVE SWINGS POSITION MANAGER (60%) */}
          <section id="portfolio-section" class="w-full lg:w-[60%] border border-alabaster bg-white shadow-sm flex flex-col shrink-0">
            {/* COLLAPSIBLE HEADER — always visible */}
            <button
              id="portfolio-toggle-btn"
              onclick="togglePortfolioPanel()"
              class="w-full h-12 px-4 flex items-center justify-between gap-4 bg-snow hover:bg-platinum border-b border-transparent transition-colors cursor-pointer group"
            >
              {/* Left: Title + Badge + Inline PnL */}
              <div class="flex items-center gap-3 min-w-0">
                <svg class="w-3.5 h-3.5 text-emerald shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                  <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
                <h2 class="text-[11px] font-extrabold tracking-wider text-carbon uppercase font-sans whitespace-nowrap">
                  ACTIVE SWINGS
                </h2>
                <span id="stat-portfolio-count-badge" class="px-1.5 py-0.5 bg-platinum text-carbon text-[10px] font-mono font-bold border border-alabaster uppercase shrink-0">
                  0 POS
                </span>
                <span class="text-alabaster hidden sm:inline">|</span>
                <span class="hidden sm:flex items-center gap-1.5 text-[10px] font-mono font-bold">
                  <span class="text-slategrey uppercase">PnL:</span>
                  <span id="port-total-pnl" class="font-extrabold text-emerald">+₹0.00</span>
                </span>
              </div>
              {/* Right: Chevron + Refresh */}
              <div class="flex items-center gap-2 shrink-0">
                <span
                  id="portfolio-refresh-btn"
                  onclick="event.stopPropagation(); fetchPortfolioData();"
                  class="px-2 py-0.5 text-[10px] font-sans font-bold text-slategrey hover:text-carbon hover:bg-platinum border border-transparent hover:border-alabaster transition-colors uppercase tracking-wider"
                >
                  REFRESH
                </span>
                <svg id="portfolio-chevron" class="w-3.5 h-3.5 text-slategrey transition-transform duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </button>

            {/* COLLAPSIBLE CONTENT — hidden by default */}
            <div id="portfolio-panel-body" class="hidden border-t border-alabaster h-[400px] flex-col">
              {/* SL Legend Bar */}
              <div class="px-4 py-1.5 flex items-center gap-4 text-[10px] font-sans font-bold text-irongrey border-b border-alabaster bg-snow shrink-0">
                <span class="flex items-center gap-1"><span class="w-2 h-2 bg-emerald inline-block"></span> &gt;50% Safe</span>
                <span class="flex items-center gap-1"><span class="w-2 h-2 bg-amber inline-block"></span> 20-50%</span>
                <span class="flex items-center gap-1"><span class="w-2 h-2 bg-crimson inline-block"></span> &lt;20% Critical</span>
              </div>

              {/* PORTFOLIO TABLE */}
              <div class="overflow-x-auto overflow-y-auto flex-grow relative">
                <table class="w-full text-left text-xs whitespace-nowrap border-collapse">
                  <thead class="bg-platinum border-b border-alabaster uppercase text-[10px] font-extrabold text-gunmetal tracking-wider">
                    <tr>
                      <th class="px-4 py-2.5 border-r border-alabaster">SYMBOL / QTY</th>
                      <th class="px-4 py-2.5 border-r border-alabaster">AVG / LTP</th>
                      <th class="px-4 py-2.5 border-r border-alabaster">UNREALIZED PnL</th>
                      <th class="px-4 py-2.5 border-r border-alabaster">DAYS HELD</th>
                      <th class="px-6 py-2.5 w-72 border-r border-alabaster">DISTANCE TO STOP-LOSS (2x ATR)</th>
                      <th class="px-4 py-2.5 text-right">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody id="portfolio-table-body" class="divide-y divide-platinum">
                    <tr>
                      <td colSpan={6} class="px-6 py-10 text-center text-slategrey">
                        <span class="font-bold text-xs uppercase tracking-widest text-slategrey font-sans">SYNCING LIVE UPSTOX PORTFOLIO...</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* SECTION 3: AI MORNING BRIEFING ENGINE (40%) */}
          <section id="morning-briefing-section" class="w-full lg:w-[40%] border border-alabaster bg-white shadow-sm flex flex-col shrink-0">
            {/* COLLAPSIBLE HEADER — always visible */}
            <button
              id="briefing-toggle-btn"
              onclick="toggleBriefingPanel()"
              class="w-full h-12 px-4 flex items-center justify-between gap-4 bg-snow hover:bg-platinum border-b border-transparent transition-colors cursor-pointer group"
            >
              {/* Left: Title + Timestamp */}
              <div class="flex items-center gap-3 min-w-0">
                <svg class="w-3.5 h-3.5 text-amber shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
                <h2 class="text-[11px] font-extrabold tracking-wider text-carbon uppercase font-sans whitespace-nowrap">
                  SIGNAL BRIEFING
                </h2>
                <span id="briefing-timestamp" class="text-[10px] font-mono font-bold text-slategrey uppercase">
                  --:--
                </span>
              </div>
              {/* Right: Copy + Refresh + Chevron */}
              <div class="flex items-center gap-2 shrink-0">
                <span
                  id="copy-briefing-btn"
                  onclick="event.stopPropagation(); copyMorningBriefing();"
                  class="hidden px-2 py-0.5 text-[10px] font-sans font-bold text-slategrey hover:text-carbon hover:bg-platinum border border-transparent hover:border-alabaster transition-colors uppercase tracking-wider"
                >
                  COPY
                </span>
                <span
                  id="briefing-refresh-btn"
                  onclick="event.stopPropagation(); fetchMorningBriefing();"
                  class="px-2 py-0.5 text-[10px] font-sans font-bold text-slategrey hover:text-carbon hover:bg-platinum border border-transparent hover:border-alabaster transition-colors uppercase tracking-wider cursor-pointer"
                >
                  REFRESH
                </span>
                <svg id="briefing-chevron" class="w-3.5 h-3.5 text-slategrey transition-transform duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </button>

            {/* COLLAPSIBLE CONTENT — hidden by default */}
            <div id="briefing-panel-body" class="hidden border-t border-alabaster h-[400px] overflow-y-auto">
              <div id="briefing-content-area" class="p-4 sm:p-5 text-sm text-carbon leading-relaxed font-sans">
                {/* Skeleton Loader */}
                <div id="briefing-skeleton" class="animate-pulse space-y-4">
                  <div class="h-4 bg-platinum rounded w-3/4"></div>
                  <div class="space-y-2 mt-4">
                    <div class="h-3 bg-platinum rounded w-full"></div>
                    <div class="h-3 bg-platinum rounded w-5/6"></div>
                    <div class="h-3 bg-platinum rounded w-full"></div>
                    <div class="h-3 bg-platinum rounded w-4/5"></div>
                  </div>
                  <div class="space-y-2 mt-6">
                    <div class="h-3 bg-platinum rounded w-full"></div>
                    <div class="h-3 bg-platinum rounded w-11/12"></div>
                    <div class="h-3 bg-platinum rounded w-full"></div>
                  </div>
                </div>

                {/* Empty State */}
                <div id="briefing-empty" class="hidden flex flex-col items-center justify-center text-center py-10">
                  <div class="w-8 h-8 border border-paleslate flex items-center justify-center bg-snow mb-3 text-slategrey">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
                      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                      <line x1="6" y1="2" x2="6" y2="4" />
                      <line x1="10" y1="2" x2="10" y2="4" />
                      <line x1="14" y1="2" x2="14" y2="4" />
                    </svg>
                  </div>
                  <h3 class="text-[10px] font-extrabold text-carbon uppercase tracking-wider">NO BRIEFING YET</h3>
                  <p class="text-[9px] text-slategrey mt-1 font-mono max-w-[180px]">
                    Daily Quant Briefing arrives ~08:30 IST.
                  </p>
                </div>

                {/* Actual Content */}
                <div id="briefing-text" class="hidden whitespace-pre-wrap text-[13px] font-sans text-carbon leading-relaxed pb-4 prose prose-sm prose-slate max-w-none"></div>
              </div>
            </div>
          </section>

        </div>

      </main>

      {/* Client-Side Logic */}
      <script dangerouslySetInnerHTML={{
        __html: `
        let allStocks = [];
        let allPortfolio = [];
        let activeTab = 'ALL';
        let isTableCollapsed = false; // EXPANDED BY DEFAULT
        let expandedRows = new Set();
        let isPortfolioPanelOpen = false;
        let isBriefingPanelOpen = false;
        let currentSortColumn = 'macd';
        let currentSortDirection = 'desc';

        function sortScreenerTable(col) {
          if (currentSortColumn === col) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortColumn = col;
            currentSortDirection = 'desc';
          }
          applyFilter();
        }
        window.sortScreenerTable = sortScreenerTable;

        function togglePortfolioPanel() {
          isPortfolioPanelOpen = !isPortfolioPanelOpen;
          const body = document.getElementById('portfolio-panel-body');
          const chevron = document.getElementById('portfolio-chevron');
          if (body) body.classList.toggle('hidden', !isPortfolioPanelOpen);
          if (chevron) chevron.style.transform = isPortfolioPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
        window.togglePortfolioPanel = togglePortfolioPanel;

        function toggleBriefingPanel() {
          isBriefingPanelOpen = !isBriefingPanelOpen;
          const body = document.getElementById('briefing-panel-body');
          const chevron = document.getElementById('briefing-chevron');
          if (body) body.classList.toggle('hidden', !isBriefingPanelOpen);
          if (chevron) chevron.style.transform = isBriefingPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
        window.toggleBriefingPanel = toggleBriefingPanel;

        function getAuthHeaders() {
          const authKey = localStorage.getItem('tfo_auth_key') || btoa('vdineshprabu:Healthywealth007#');
          return {
            'Authorization': 'Basic ' + authKey
          };
        }

        async function fetchMTFSetups() {
          try {
            const res = await fetch('/api/mtf-screener', { headers: getAuthHeaders() });
            if (!res.ok) {
              console.error("fetchMTFSetups HTTP status:", res.status);
              return;
            }
            const response = await res.json();
            if (response.success) {
              allStocks = response.data || [];
              applyFilter();
            }
          } catch (e) {
            console.error("Failed to fetch MTF data:", e);
          }
        }

        async function fetchPortfolioData() {
          const btn = document.getElementById('portfolio-refresh-btn');
          if (btn) btn.innerText = 'REFRESHING...';
          try {
            const res = await fetch('/api/mtf-portfolio', { headers: getAuthHeaders() });
            if (!res.ok) return;
            const response = await res.json();
            if (response.success) {
              allPortfolio = response.data || [];
              renderPortfolioTable(allPortfolio);
              updatePortfolioMetrics(allPortfolio);
            }
          } catch (e) {
            console.error("Failed to fetch Portfolio data:", e);
          } finally {
            if (btn) btn.innerText = 'REFRESH';
          }
        }
        window.fetchPortfolioData = fetchPortfolioData;

        async function fetchMorningBriefing() {
          const btn = document.getElementById('briefing-refresh-btn');
          if (btn) btn.innerText = 'REFRESHING...';
          try {
            document.getElementById('briefing-skeleton').style.display = 'block';
            document.getElementById('briefing-empty').style.display = 'none';
            document.getElementById('briefing-text').style.display = 'none';
            document.getElementById('copy-briefing-btn').style.display = 'none';
            document.getElementById('briefing-timestamp').innerText = 'SYNCING...';

            const res = await fetch('/api/morning-briefing', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Network response was not ok');
            const response = await res.json();
            
            document.getElementById('briefing-skeleton').style.display = 'none';

            if (response.success && response.content) {
              document.getElementById('briefing-text').innerHTML = response.content;
              document.getElementById('briefing-text').style.display = 'block';
              document.getElementById('copy-briefing-btn').style.display = 'block';
              
              const d = new Date(response.generatedAt);
              const timeStr = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit' });
              
              if (response.isToday) {
                document.getElementById('briefing-timestamp').innerText = \`TODAY, \${timeStr} IST\`;
                document.getElementById('briefing-timestamp').classList.replace('text-slategrey', 'text-emerald');
              } else {
                document.getElementById('briefing-timestamp').innerText = \`\${response.briefingDate} \${timeStr} IST\`;
                document.getElementById('briefing-timestamp').classList.replace('text-emerald', 'text-amber');
              }
            } else {
              document.getElementById('briefing-empty').style.display = 'flex';
              document.getElementById('briefing-timestamp').innerText = '--:--';
              document.getElementById('briefing-timestamp').classList.replace('text-emerald', 'text-slategrey');
            }
          } catch (e) {
            console.error("Failed to fetch Morning Briefing:", e);
            document.getElementById('briefing-skeleton').style.display = 'none';
            document.getElementById('briefing-empty').style.display = 'flex';
            document.getElementById('briefing-timestamp').innerText = 'ERROR';
          } finally {
            if (btn) btn.innerText = 'REFRESH';
          }
        }
        window.fetchMorningBriefing = fetchMorningBriefing;

        window.copyMorningBriefing = function() {
          const text = document.getElementById('briefing-text').innerText;
          navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-briefing-btn');
            btn.innerText = 'COPIED!';
            setTimeout(() => btn.innerText = 'COPY', 2000);
          });
        };

        function updatePortfolioMetrics(positions) {
          const totalPnl = positions.reduce((acc, pos) => acc + Number(pos.unrealized_pnl || 0), 0);
          const pnlElem = document.getElementById('port-total-pnl');
          const countElem = document.getElementById('stat-portfolio-count-badge');
          const statNavElem = document.getElementById('stat-portfolio-count');

          if (pnlElem) {
            pnlElem.innerText = (totalPnl >= 0 ? '+₹' : '-₹') + Math.abs(totalPnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            pnlElem.className = 'font-mono font-extrabold ' + (totalPnl >= 0 ? 'text-emerald' : 'text-crimson');
          }
          if (countElem) countElem.innerText = positions.length + ' POS';
          if (statNavElem) statNavElem.innerText = positions.length;
        }

        function renderPortfolioTable(positions) {
          const tbody = document.getElementById('portfolio-table-body');
          if (!positions || positions.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="6" class="px-6 py-12 text-center text-slategrey font-sans">
                  <span class="font-extrabold text-xs uppercase tracking-widest text-paleslate2">[ NO ACTIVE POSITIONS IN PORTFOLIO ]</span>
                </td>
              </tr>\`;
            return;
          }

          tbody.innerHTML = positions.map(pos => {
            const sym = pos.tradingsymbol;
            const price = Number(pos.current_price || 0);
            const avg = Number(pos.average_price || 0);
            const pnl = Number(pos.unrealized_pnl || 0);
            const pnlPct = Number(pos.pnl_percent || 0);
            const sl = Number(pos.trailing_sl || (avg * 0.95));
            const atr = Number(pos.current_atr || (price * 0.015));

            // SL Progress Math (0% = Hit SL, 100% = High Profit Safety)
            const range = price - sl;
            const atrDistance = atr * 2;
            let healthPct = (range / atrDistance) * 100;
            healthPct = Math.max(0, Math.min(100, healthPct));

            const healthColor = healthPct > 50 ? 'bg-emerald' : healthPct > 20 ? 'bg-amber' : 'bg-crimson';
            const healthTextClass = healthPct > 50 ? 'text-emerald-dark font-extrabold' : healthPct > 20 ? 'text-amber-dark font-extrabold' : 'text-crimson-dark font-extrabold';

            return \`
              <tr class="table-row-terminal-light border-b border-alabaster bg-white">
                <!-- Symbol & Qty -->
                <td class="px-4 py-3.5 border-r border-alabaster">
                  <div class="flex items-center gap-2">
                    <span class="font-extrabold text-carbon text-sm uppercase font-sans tracking-tight">\${sym}</span>
                    <span class="px-1.5 py-0.5 bg-platinum text-gunmetal text-[10px] font-mono font-bold border border-alabaster uppercase">
                      QTY: \${pos.quantity}
                    </span>
                  </div>
                </td>

                <!-- Avg & LTP -->
                <td class="px-4 py-3.5 font-mono border-r border-alabaster">
                  <div class="text-xs text-slategrey font-semibold">AVG: ₹\${avg.toFixed(2)}</div>
                  <div class="text-sm font-extrabold text-carbon mt-0.5">LTP: ₹\${price.toFixed(2)}</div>
                </td>

                <!-- Unrealized PnL -->
                <td class="px-4 py-3.5 font-mono border-r border-alabaster">
                  <div class="text-sm font-extrabold \${pnl >= 0 ? 'text-emerald' : 'text-crimson'}">
                    \${pnl >= 0 ? '+' : ''}₹\${pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div class="text-[10px] font-bold \${pnlPct >= 0 ? 'text-emerald-dark' : 'text-crimson-dark'}">
                    (\${pnlPct >= 0 ? '+' : ''}\${pnlPct.toFixed(2)}%)
                  </div>
                </td>

                <!-- Days Held -->
                <td class="px-4 py-3.5 font-mono border-r border-alabaster">
                  <div class="flex items-center gap-1">
                    <span class="font-bold text-irongrey text-xs">\${pos.days_held} DAYS</span>
                    \${pos.days_held > 10 ? '<span class="text-amber text-xs" title="Extended holding duration">⚠️</span>' : ''}
                  </div>
                </td>

                <!-- Distance to Stop-Loss (2x ATR) -->
                <td class="px-6 py-3.5 border-r border-alabaster">
                  <div class="flex justify-between items-center text-[10px] font-mono font-bold mb-1">
                    <span class="text-crimson uppercase">SL: ₹\${sl.toFixed(2)}</span>
                    <span class="\${healthTextClass} uppercase">\${healthPct.toFixed(0)}% SAFE</span>
                  </div>
                  <div class="w-full bg-platinum h-2 border border-alabaster overflow-hidden">
                    <div 
                      class="h-full transition-all duration-500 ease-out \${healthColor}" 
                      style="width: \${healthPct}%"
                    ></div>
                  </div>
                </td>

                <!-- Actions -->
                <td class="px-4 py-3.5 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      onclick="copyTradePlan('\${sym}', \${price}, \${sl.toFixed(2)}, \${atr.toFixed(2)}, '1.0')"
                      class="px-2.5 py-1 text-xs font-sans font-extrabold bg-platinum hover:bg-carbon hover:text-snow text-carbon border border-alabaster transition-all uppercase"
                    >
                      COPY PLAN
                    </button>
                    <a 
                      href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}" 
                      target="_blank" 
                      rel="noreferrer"
                      class="px-2.5 py-1 text-xs font-sans font-extrabold bg-white hover:bg-carbon hover:text-snow text-carbon border border-alabaster transition-all uppercase"
                    >
                      CHART ↗
                    </a>
                  </div>
                </td>
              </tr>
            \`;
          }).join('');
        }

        function setFilterTab(tab) {
          activeTab = tab;
          ['ALL', 'HIGH', 'ZERO_CROSS', 'HIGH_RVOL'].forEach(t => {
            const btn = document.getElementById('tab-' + t);
            if (btn) {
              if (t === tab) {
                btn.className = 'px-3 py-1.5 text-xs font-extrabold text-snow bg-carbon transition-colors cursor-pointer uppercase tracking-wider';
              } else {
                btn.className = 'px-3 py-1.5 text-xs font-bold text-irongrey hover:text-carbon hover:bg-paleslate transition-colors cursor-pointer uppercase tracking-wider border-l border-alabaster';
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
          const badgeElem = document.getElementById('setup-count-badge');
          
          if (totalElem) totalElem.innerText = stocks.length;
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
        window.toggleTableCollapse = toggleTableCollapse;

        function updateCollapsedSummary(stocks) {
          const listElem = document.getElementById('collapsed-tickers-list');
          if (!listElem) return;
          if (stocks.length === 0) {
            listElem.innerHTML = '<span class="text-paleslate2 font-sans text-xs">[NO SETUPS MATCHING FILTER]</span>';
            return;
          }
          listElem.innerHTML = stocks.slice(0, 10).map(s => \`
            <span class="px-2 py-0.5 bg-snow border border-alabaster text-carbon font-bold text-[11px] flex items-center gap-1.5 font-sans">
              \${s.tradingsymbol}
              <span class="text-[10px] text-carbon font-mono font-extrabold">₹\${Number(s.current_price).toFixed(1)}</span>
            </span>
          \`).join('') + (stocks.length > 10 ? \`<span class="text-slategrey text-[10px] font-bold font-sans">+\${stocks.length - 10} MORE</span>\` : '');
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
        window.toggleRowDetails = toggleRowDetails;

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
        window.toggleExpandAllRows = toggleExpandAllRows;

        function showToast(message, type = 'success') {
          const container = document.getElementById('toast-container');
          if (!container) return;
          const toast = document.createElement('div');
          toast.className = 'pointer-events-auto px-4 py-2 border text-xs font-extrabold flex items-center gap-2 bg-carbon text-snow border-gunmetal uppercase tracking-wider shadow-lg font-sans';
          toast.innerHTML = \`
            <span class="w-1.5 h-1.5 bg-emerald"></span>
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
        window.copyTradePlan = copyTradePlan;

        function renderTable(stocks) {
          const tbody = document.getElementById('screener-table-body');
          if (!stocks || stocks.length === 0) {
            tbody.innerHTML = \`
              <tr>
                <td colspan="7" class="px-6 py-16 text-center text-slategrey font-sans">
                  <p class="text-carbon font-extrabold text-sm uppercase tracking-widest">[ NO ACTIVE MTF SETUPS MATCHING CRITERIA ]</p>
                  <p class="text-xs text-slategrey mt-1 uppercase font-mono">CONTINUOUS 30M / 3H UPSTOX CANDLE SCANNER RUNNING...</p>
                </td>
              </tr>\`;
            return;
          }

          // Dynamic sorting based on column
          const sorted = [...stocks].sort((a, b) => {
            if (a.conviction === 'HIGH' && b.conviction !== 'HIGH') return -1;
            if (b.conviction === 'HIGH' && a.conviction !== 'HIGH') return 1;
            
            let valA, valB;
            switch(currentSortColumn) {
              case 'asset': valA = a.tradingsymbol; valB = b.tradingsymbol; break;
              case 'ltp': valA = Number(a.current_price || 0); valB = Number(b.current_price || 0); break;
              case 'vwap': valA = Number(a.distance_from_vwap_pct || 0); valB = Number(b.distance_from_vwap_pct || 0); break;
              case 'macd': valA = Number(a.macd_value || 0); valB = Number(b.macd_value || 0); break;
              case 'rsi': valA = Number(a.rsi_14 || 50); valB = Number(b.rsi_14 || 50); break;
              case 'atr': valA = Number(a.atr_stop_loss || 0); valB = Number(b.atr_stop_loss || 0); break;
              default: valA = Number(a.macd_value || 0); valB = Number(b.macd_value || 0); break;
            }
            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
          });

          // Update sort indicators
          document.querySelectorAll('.sort-icon').forEach(icon => icon.innerHTML = '');
          const activeIcon = document.querySelector(\`.sort-icon[data-col="\${currentSortColumn}"]\`);
          if (activeIcon) {
            activeIcon.innerHTML = currentSortDirection === 'asc' ? '▲' : '▼';
          }

          const signalMap = {
            'ZERO_LINE_CROSS':    { label: 'ZERO CROSS', bg: 'bg-emerald-light text-emerald-dark border-emerald-border font-extrabold' },
            'SIGNAL_LINE_CROSS':  { label: 'SIGNAL CROSS', bg: 'bg-platinum text-carbon border-alabaster font-extrabold' },
            'APPROACHING_ZERO':   { label: 'APPROACHING ZERO', bg: 'bg-snow text-slategrey border-alabaster font-bold' },
            'EMA_GOLDEN_CROSS':   { label: 'EMA GOLDEN CROSS', bg: 'bg-emerald-light text-emerald-dark border-emerald-border font-extrabold' },
            'BULLISH_ENGULFING':  { label: 'BULLISH ENGULF', bg: 'bg-emerald-light text-emerald-dark border-emerald-border font-bold' },
            'HAMMER':             { label: 'HAMMER', bg: 'bg-emerald-light text-emerald-dark border-emerald-border font-bold' },
            'RSI_REVERSAL':       { label: 'RSI REVERSAL', bg: 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] font-bold' },
            'RSI_50_CROSS':       { label: 'RSI 50 CROSS', bg: 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] font-bold' },
            'BULLISH_MOMENTUM':   { label: 'BULLISH', bg: 'bg-emerald-light text-emerald-dark border-emerald-border font-bold' },
          };

          tbody.innerHTML = sorted.map(stock => {
            const sym = stock.tradingsymbol;
            const isExpanded = expandedRows.has(sym);

            const sig = signalMap[stock.macd_signal] || signalMap['BULLISH_MOMENTUM'];
            const macdBadge = \`<span class="px-2 py-0.5 text-[10px] font-sans font-extrabold tracking-wider uppercase border \${sig.bg}">
                \${sig.label}
              </span>\`;

            const rsiVal = Number(stock.rsi_14 || 50);
            const rsiClass = rsiVal > 60 ? 'text-emerald font-extrabold' : (rsiVal < 40 ? 'text-crimson font-extrabold' : 'text-irongrey font-bold');
            
            const rvolVal = Number(stock.rvol || 1.0);
            const isHighRvol = rvolVal > 2.5;
            const rvolBadgeClass = isHighRvol
              ? 'bg-amber-light text-amber-dark border-amber-border font-extrabold'
              : 'bg-platinum text-slategrey border-alabaster font-bold';

            const distVwap = Number(stock.distance_from_vwap_pct || 0);
            const vwapDistClass = distVwap > 2.0
              ? 'text-amber-dark font-extrabold'
              : (distVwap < 0 ? 'text-crimson font-extrabold' : 'text-emerald font-extrabold');

            const priceNum = Number(stock.current_price || 0);
            const atrVal = Number(stock.atr_value || (priceNum * 0.015)).toFixed(2);
            const rawSL = stock.suggested_sl || (priceNum - Number(atrVal) * 2);
            const formattedSL = Number(rawSL).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });

            const isHighConviction = stock.conviction === 'HIGH';
            const convictionBadge = isHighConviction
              ? \`<span class="px-1.5 py-0.5 text-[9px] font-sans font-extrabold tracking-widest bg-carbon text-snow uppercase shadow-2xs">
                  HIGH
                </span>\`
              : \`<span class="px-1.5 py-0.5 text-[9px] font-sans font-bold tracking-widest bg-platinum text-slategrey border border-alabaster uppercase">
                  30M
                </span>\`;

            const marginMult = stock.mtf_margin_multiplier || 3.5;
            const riskPerShare = Math.max(0.05, priceNum - Number(rawSL));
            const target1 = (priceNum + riskPerShare * 1.5).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const target2 = (priceNum + riskPerShare * 3.0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const adxVal = stock.adx_trend ? Number(stock.adx_trend).toFixed(1) : '24.5';

            return \`
              <!-- SUMMARY ROW -->
              <tr class="table-row-terminal-light transition-all border-b border-alabaster \${isHighConviction ? 'bg-snow' : 'bg-white'}">
                <!-- Asset & Volume -->
                <td class="px-4 py-3.5 border-r border-alabaster">
                  <div class="flex items-center gap-2">
                    <button onclick="toggleRowDetails('\${sym}')" class="font-extrabold text-carbon text-sm hover:text-slategrey transition-colors cursor-pointer uppercase font-sans tracking-tight">\${sym}</button>
                    \${convictionBadge}
                    <span class="px-1.5 py-0.5 text-[9px] font-mono tracking-wider border \${rvolBadgeClass}">
                      RVOL \${rvolVal}x
                    </span>
                  </div>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-[9px] font-sans font-bold text-slategrey tracking-wider uppercase">\${stock.sector || 'EQUITY'}</span>
                    <span class="text-[9px] font-mono font-extrabold text-carbon bg-platinum px-1 py-0.1 border border-alabaster">\${marginMult}X MTF</span>
                  </div>
                </td>

                <!-- LTP -->
                <td class="px-4 py-3.5 font-mono font-extrabold text-carbon text-sm border-r border-alabaster">
                  ₹\${priceNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>

                <!-- VWAP Dev. -->
                <td class="px-4 py-3.5 font-mono border-r border-alabaster">
                  <div class="flex flex-col">
                    <span class="text-xs \${vwapDistClass}">
                      \${distVwap > 0 ? '+' : ''}\${distVwap}%
                    </span>
                    <span class="text-[9px] text-slategrey font-sans font-bold tracking-wide uppercase">VWAP DEV</span>
                  </div>
                </td>

                <!-- MACD 30m -->
                <td class="px-4 py-3.5 border-r border-alabaster">
                  \${macdBadge}
                  <span class="ml-2 font-mono text-xs text-slategrey font-bold">(\${stock.macd_value})</span>
                </td>

                <!-- RSI / ADX -->
                <td class="px-4 py-3.5 border-r border-alabaster">
                  <div class="flex flex-col font-mono text-xs">
                    <span class="\${rsiClass}">RSI: \${rsiVal}</span>
                    <span class="text-[10px] text-slategrey font-bold">ADX: \${adxVal}</span>
                  </div>
                </td>

                <!-- Struct SL (ATR) -->
                <td class="px-4 py-2.5 border-r border-alabaster">
                  <div class="bg-crimson-light border border-crimson-border p-2 w-44">
                    <div class="flex justify-between items-center text-[9px] font-mono text-slategrey pb-0.5 border-b border-crimson-border">
                      <span class="uppercase font-sans font-bold">BASE LTP</span>
                      <span class="font-extrabold text-carbon">₹\${priceNum.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-[9px] font-mono text-slategrey py-0.5 border-b border-crimson-border">
                      <span class="font-semibold">2x ATR (\${atrVal})</span>
                      <span class="font-extrabold text-crimson-dark">-₹\${(Number(atrVal) * 2).toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs font-mono font-extrabold pt-1">
                      <span class="text-carbon font-sans uppercase">STOP</span>
                      <span class="text-crimson-dark bg-white px-1 py-0.5 border border-crimson-border">
                        ₹\${formattedSL}
                      </span>
                    </div>
                  </div>
                </td>

                <!-- Actions -->
                <td class="px-4 py-3.5 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <a 
                      href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}" 
                      target="_blank" 
                      rel="noreferrer"
                      class="px-2.5 py-1 text-xs font-sans font-extrabold bg-white hover:bg-carbon hover:text-snow text-carbon border border-alabaster hover:border-carbon transition-all uppercase shadow-2xs"
                    >
                      CHART ↗
                    </a>
                    <button
                      onclick="toggleRowDetails('\${sym}')"
                      class="px-2 py-1 bg-white hover:bg-platinum text-carbon border border-alabaster transition-colors cursor-pointer text-xs font-sans font-bold"
                      title="Trade Details Matrix"
                    >
                      DETAILS
                    </button>
                  </div>
                </td>
              </tr>

              <!-- EXPANDABLE ACCORDION DETAIL ROW -->
              <tr id="detail-row-\${sym}" class="\${isExpanded ? '' : 'hidden'} bg-carbon text-snow border-b border-gunmetal">
                <td colSpan="7" class="p-4 sm:p-5">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                    
                    <!-- Panel 1: Technical Matrix -->
                    <div class="terminal-glass-panel-dark p-3.5 space-y-2">
                      <div class="flex items-center justify-between border-b border-gunmetal pb-1.5">
                        <span class="font-sans font-extrabold uppercase tracking-wider text-paleslate2 text-[10px]">TECHNICAL MATRIX</span>
                        <span class="text-emerald font-black font-sans">\${sym}</span>
                      </div>
                      <div class="space-y-1.5 text-[11px]">
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">30m MACD Histogram:</span>
                          <span class="font-extrabold text-snow">\${stock.macd_value}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">Signal Confluence:</span>
                          <span class="font-extrabold text-emerald font-sans">\${sig.label}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">RVOL Multiplier:</span>
                          <span class="font-extrabold \${isHighRvol ? 'text-amber' : 'text-snow'}">\${rvolVal}x</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">RSI Oscillator:</span>
                          <span class="font-extrabold text-snow">\${rsiVal}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">ADX Trend Vector:</span>
                          <span class="font-extrabold text-emerald">\${adxVal}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 2: Risk & Targets -->
                    <div class="terminal-glass-panel-dark p-3.5 space-y-2">
                      <div class="flex items-center justify-between border-b border-gunmetal pb-1.5">
                        <span class="font-sans font-extrabold uppercase tracking-wider text-paleslate2 text-[10px]">QUANT RISK & TARGETS</span>
                        <span class="text-emerald font-mono font-bold">1:1.5 TO 1:3 RR</span>
                      </div>
                      <div class="space-y-1.5 text-[11px]">
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">Execution LTP:</span>
                          <span class="font-extrabold text-snow">₹\${priceNum.toFixed(2)}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">ATR Stop Loss (2x):</span>
                          <span class="font-extrabold text-crimson">₹\${formattedSL}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">Target 1 (1.5R):</span>
                          <span class="font-extrabold text-emerald">₹\${target1}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">Target 2 (3.0R):</span>
                          <span class="font-extrabold text-emerald">₹\${target2}</span>
                        </div>
                        <div class="flex justify-between text-paleslate">
                          <span class="font-sans text-paleslate2">Risk Delta / Share:</span>
                          <span class="font-extrabold text-emerald">₹\${riskPerShare.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Panel 3: Execution & Copy Plan -->
                    <div class="terminal-glass-panel-dark p-3.5 flex flex-col justify-between space-y-2">
                      <div>
                        <div class="flex items-center justify-between border-b border-gunmetal pb-1.5">
                          <span class="font-sans font-extrabold uppercase tracking-wider text-paleslate2 text-[10px]">MARGIN & EXECUTION</span>
                          <span class="text-emerald font-mono font-bold">\${marginMult}X MARGIN</span>
                        </div>
                        <p class="text-paleslate2 text-[10px] font-sans mt-2 leading-relaxed uppercase">
                          REQUIRED MTF MARGIN: <strong class="text-snow font-mono">₹\${(priceNum / marginMult).toFixed(2)}</strong> / SHARE.
                        </p>
                      </div>

                      <div class="flex items-center gap-2 pt-2 border-t border-gunmetal">
                        <button
                          onclick="copyTradePlan('\${sym}', \${priceNum}, \${Number(rawSL).toFixed(2)}, \${atrVal}, \${rvolVal})"
                          class="flex-1 py-1.5 text-xs font-sans font-extrabold bg-snow hover:bg-platinum text-carbon uppercase transition-all cursor-pointer shadow-sm tracking-wider"
                        >
                          COPY TRADE PLAN
                        </button>
                        <a
                          href="https://in.tradingview.com/chart/?symbol=NSE:\${sym}"
                          target="_blank"
                          rel="noreferrer"
                          class="px-3 py-1.5 text-xs font-sans font-extrabold bg-gunmetal hover:bg-irongrey text-snow border border-gunmetal uppercase transition-colors tracking-wider"
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
          
          if (btn) {
            btn.className = 'flex items-center gap-2 px-4 py-1.5 text-xs font-extrabold text-slategrey bg-platinum border border-alabaster cursor-not-allowed uppercase tracking-wider font-sans';
          }
          if (btnText) btnText.innerText = 'SCANNING...';
          
          try {
            await fetch('/api/mtf-screener/trigger', { method: 'POST', headers: getAuthHeaders() });
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
            btn.className = 'flex items-center gap-2 px-4 py-1.5 text-xs font-extrabold text-snow bg-carbon hover:bg-gunmetal transition-all active:translate-y-0.5 cursor-pointer uppercase tracking-wider font-sans';
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
        fetchPortfolioData();
        fetchMorningBriefing();

        // 60-Second Data Loop
        setInterval(() => {
          fetchMTFSetups();
          fetchPortfolioData();
          fetchMorningBriefing();
        }, 60000);

        // Live 1-Second Countdown Counter
        updateLiveScanCountdown();
        setInterval(updateLiveScanCountdown, 1000);
      ` }}></script>
    </body>
  </html>
);
