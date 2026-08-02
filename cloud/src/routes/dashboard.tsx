// ============================================
// Dashboard — Modern Hono Server-Rendered Template
// TheFinalOption Swing Trading Terminal & Quant Dashboard
// ============================================

import { Hono } from 'hono';
import type { Env } from '../lib/types';

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get('/', (c) => {
	c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
	c.header('Pragma', 'no-cache');
	c.header('Expires', '0');

	const html = `<!DOCTYPE html><html class="light" lang="en">
<head>
<meta charset="utf-8">
<meta content="width=device-width, initial-scale=1.0" name="viewport">
<title>TheFinalOption - Swing Trading Terminal</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<script id="tailwind-config">
  tailwind.config = {
    darkMode: "class",
    theme: {
      extend: {
        "colors": {
                "inverse-on-surface": "#e9f2fb",
                "error-container": "#ffdad6",
                "surface-container": "#e6eff8",
                "surface-container-highest": "#dbe4ed",
                "on-surface": "#141d23",
                "on-primary": "#ffffff",
                "surface-dim": "#d2dbe4",
                "outline": "#75777b",
                "surface-container-high": "#e0e9f2",
                "secondary-fixed": "#6ffbbe",
                "on-tertiary-fixed": "#410004",
                "surface-container-lowest": "#ffffff",
                "inverse-surface": "#293138",
                "surface-tint": "#5b5f63",
                "on-tertiary-container": "#fa4c4b",
                "inverse-primary": "#c3c7cc",
                "surface-variant": "#dbe4ed",
                "on-tertiary": "#ffffff",
                "on-error": "#ffffff",
                "tertiary": "#2a0002",
                "primary-fixed-dim": "#c3c7cc",
                "on-background": "#141d23",
                "tertiary-fixed-dim": "#ffb3ad",
                "on-surface-variant": "#44474a",
                "surface-container-low": "#ecf5fe",
                "primary-fixed": "#e0e3e8",
                "on-primary-fixed": "#181c20",
                "on-primary-container": "#888c91",
                "secondary": "#006c49",
                "primary-container": "#212529",
                "on-secondary-fixed": "#002113",
                "secondary-fixed-dim": "#4edea3",
                "secondary-container": "#6cf8bb",
                "surface": "#f6faff",
                "primary": "#0c1014",
                "surface-bright": "#f6faff",
                "error": "#ba1a1a",
                "on-secondary": "#ffffff",
                "background": "#f6faff",
                "on-secondary-fixed-variant": "#005236",
                "on-error-container": "#93000a",
                "on-tertiary-fixed-variant": "#930013",
                "tertiary-container": "#520006",
                "outline-variant": "#c5c6ca",
                "on-secondary-container": "#00714d",
                "on-primary-fixed-variant": "#43474c",
                "tertiary-fixed": "#ffdad7"
        },
        "borderRadius": {
                "DEFAULT": "0.25rem",
                "lg": "0.375rem",
                "xl": "0.5rem",
                "2xl": "0.75rem",
                "full": "9999px"
        },
        "spacing": {
                "lg": "32px",
                "base": "4px",
                "sm": "16px",
                "margin-desktop": "32px",
                "xs": "8px",
                "xl": "48px",
                "md": "24px",
                "margin-mobile": "16px",
                "gutter": "20px"
        },
        "fontFamily": {
                "label-caps": [
                        "Inter", "sans-serif"
                ],
                "headline-md": [
                        "Inter", "sans-serif"
                ],
                "display-lg": [
                        "Inter", "sans-serif"
                ],
                "body-md": [
                        "Inter", "sans-serif"
                ],
                "display-lg-mobile": [
                        "Inter", "sans-serif"
                ],
                "data-mono": [
                        "JetBrains Mono", "monospace"
                ],
                "body-sm": [
                        "Inter", "sans-serif"
                ],
                "data-mono-lg": [
                        "JetBrains Mono", "monospace"
                ]
        },
        "fontSize": {
                "label-caps": [
                        "12px",
                        {
                                "lineHeight": "16px",
                                "letterSpacing": "0.05em",
                                "fontWeight": "600"
                        }
                ],
                "headline-md": [
                        "20px",
                        {
                                "lineHeight": "28px",
                                "fontWeight": "600"
                        }
                ],
                "display-lg": [
                        "30px",
                        {
                                "lineHeight": "38px",
                                "letterSpacing": "-0.02em",
                                "fontWeight": "700"
                        }
                ],
                "body-md": [
                        "15px",
                        {
                                "lineHeight": "22px",
                                "fontWeight": "400"
                        }
                ],
                "display-lg-mobile": [
                        "22px",
                        {
                                "lineHeight": "28px",
                                "fontWeight": "700"
                        }
                ],
                "data-mono": [
                        "13px",
                        {
                                "lineHeight": "18px",
                                "letterSpacing": "-0.01em",
                                "fontWeight": "500"
                        }
                ],
                "body-sm": [
                        "13px",
                        {
                                "lineHeight": "18px",
                                "fontWeight": "400"
                        }
                ],
                "data-mono-lg": [
                        "17px",
                        {
                                "lineHeight": "22px",
                                "fontWeight": "600"
                        }
                ]
        },
        "boxShadow": {
            'soft': '0 4px 20px rgba(0, 0, 0, 0.04)',
            'drawer': '-10px 0 30px rgba(0, 0, 0, 0.15)',
        }
      }
    }
  }
</script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .material-symbols-outlined.fill {
            font-variation-settings: 'FILL' 1;
        }
        
        /* Tabular Numbers for Metrics: Stops table from wiggling on live refresh */
        .tabular-nums {
            font-variant-numeric: tabular-nums;
            -webkit-font-feature-settings: "tnum";
            font-feature-settings: "tnum";
        }

        /* Sticky Table Header */
        .sticky-thead th {
            position: sticky;
            top: 0;
            z-index: 20;
        }

        /* Row hover actions & highlights */
        .table-row-hover {
            transition: background-color 150ms ease;
        }
        .table-row-hover:hover {
            background-color: #ecf5fe;
        }
        .table-row-hover .hover-action-btn {
            opacity: 0;
            transform: translateX(4px);
            transition: all 150ms ease;
        }
        .table-row-hover:hover .hover-action-btn {
            opacity: 1;
            transform: translateX(0);
        }

        /* Hover lift for cards */
        .hover-lift {
            transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
        }
        .hover-lift:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
            border-color: #a8b0b9;
        }

        /* Animations */
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translate3d(0, 14px, 0);
            }
            to {
                opacity: 1;
                transform: translate3d(0, 0, 0);
            }
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.4s ease-out forwards;
        }
        .delay-100 { animation-delay: 80ms; }
        .delay-200 { animation-delay: 160ms; }
        .delay-300 { animation-delay: 240ms; }
        
        /* Hide scrollbar */
        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }

        /* Custom Drawer Transitions */
        #account-drawer {
            transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        #drawer-backdrop {
            transition: opacity 300ms ease;
        }

        /* Sidebar collapse transition */
        #sidebar-nav, #main-content-container {
            transition: width 250ms ease, margin-left 250ms ease;
        }
        
        /* Pulse dots */
        .live-pulse {
            box-shadow: 0 0 0 0 rgba(0, 108, 73, 0.7);
            animation: pulse-green 2s infinite;
        }
        .error-pulse {
            box-shadow: 0 0 0 0 rgba(186, 26, 26, 0.7);
            animation: pulse-red 2s infinite;
        }
        @keyframes pulse-green {
            0% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(0, 108, 73, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 6px rgba(0, 108, 73, 0);
            }
            100% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(0, 108, 73, 0);
            }
        }
        @keyframes pulse-red {
            0% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(186, 26, 26, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 6px rgba(186, 26, 26, 0);
            }
            100% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(186, 26, 26, 0);
            }
        }
    </style>
</head>
<body class="bg-background text-on-background font-body-md text-body-md antialiased overflow-x-hidden relative min-h-screen flex">

<!-- Collapsible SideNavBar (Desktop) -->
<nav id="sidebar-nav" class="bg-surface dark:bg-primary docked h-screen w-64 hidden md:flex flex-col border-r border-outline-variant fixed left-0 top-0 z-40 p-md gap-xs">
<div class="flex items-center justify-between mb-md px-1">
  <div class="flex items-center gap-2 overflow-hidden">
    <div class="w-8 h-8 rounded-lg bg-primary flex-shrink-0 flex items-center justify-center text-on-primary font-bold font-data-mono text-sm">FO</div>
    <span class="sidebar-label font-display-lg text-display-lg font-black text-primary dark:text-primary-fixed tracking-tight whitespace-nowrap">TheFinalOption</span>
  </div>
  <button onclick="toggleSidebarCollapse()" title="Toggle Sidebar Collapse" class="p-1 rounded-lg hover:bg-surface-container text-outline hover:text-primary transition-colors">
    <span id="sidebar-collapse-icon" class="material-symbols-outlined text-[20px]">chevron_left</span>
  </button>
</div>

<div class="flex flex-col gap-1.5 flex-1 font-body-md text-body-md font-label-caps text-label-caps">
  <a class="text-primary dark:text-primary-fixed font-bold border-r-2 border-primary dark:border-primary-fixed rounded-lg flex items-center gap-sm px-3.5 py-3 active:scale-98 transition-transform hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 bg-surface-container-low" href="/" title="Dashboard">
    <span class="material-symbols-outlined text-[20px] flex-shrink-0">dashboard</span>
    <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">Dashboard</span>
  </a>
  <a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center gap-sm px-3.5 py-3" href="/mtf-screener" title="Screener">
    <span class="material-symbols-outlined text-[20px] flex-shrink-0">filter_list</span>
    <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">Screener</span>
  </a>
  <button onclick="openAccountDrawer('positions')" class="w-full text-left text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center justify-between px-3.5 py-3" title="Portfolio">
    <div class="flex items-center gap-sm overflow-hidden">
      <span class="material-symbols-outlined text-[20px] flex-shrink-0">account_balance_wallet</span>
      <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">Portfolio</span>
    </div>
    <span id="nav-pos-count-badge" class="sidebar-label px-1.5 py-0.5 text-[10px] font-data-mono font-bold bg-secondary/15 text-secondary rounded">0</span>
  </button>
  <button onclick="openAccountDrawer('funds')" class="w-full text-left text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center gap-sm px-3.5 py-3" title="Funds & Margin">
    <span class="material-symbols-outlined text-[20px] flex-shrink-0">payments</span>
    <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">Funds & Margin</span>
  </button>
  <button onclick="openAccountDrawer('orders')" class="w-full text-left text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center gap-sm px-3.5 py-3" title="Order Ledger">
    <span class="material-symbols-outlined text-[20px] flex-shrink-0">receipt_long</span>
    <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">Order Book</span>
  </button>
  <button onclick="openAccountDrawer('history')" class="w-full text-left text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center gap-sm px-3.5 py-3" title="Screener History">
    <span class="material-symbols-outlined text-[20px] flex-shrink-0">history</span>
    <span class="sidebar-label uppercase tracking-wider whitespace-nowrap">History</span>
  </button>
</div>

<div class="mt-auto flex flex-col gap-1 font-body-md text-body-md font-label-caps text-label-caps border-t border-outline-variant/40 pt-3">
  <!-- Persistent Upstox Connection Badge -->
  <div id="upstox-status-badge" class="px-3 py-2 bg-surface-container-low rounded-lg flex items-center justify-between mb-1" title="Upstox API Status">
    <div class="flex items-center gap-2 overflow-hidden">
      <span id="upstox-status-dot" class="w-2.5 h-2.5 rounded-full bg-secondary live-pulse flex-shrink-0"></span>
      <span id="upstox-status-text" class="sidebar-label text-[11px] font-bold text-on-surface-variant uppercase whitespace-nowrap">Upstox Online</span>
    </div>
    <span id="header-sync-time" class="sidebar-label font-data-mono text-[10px] text-outline">SYNCED</span>
  </div>
  <a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-200 rounded-lg flex items-center gap-sm px-3.5 py-2.5" href="/api/auth/login" title="Re-Auth Upstox Settings">
    <span class="material-symbols-outlined text-[18px] flex-shrink-0">settings</span>
    <span class="sidebar-label uppercase tracking-wider text-[11px] whitespace-nowrap">Settings & Auth</span>
  </a>
</div>
</nav>

<!-- Main Content Area -->
<div id="main-content-container" class="flex-1 md:ml-64 flex flex-col min-h-screen bg-background">
  <!-- Top Sticky Header -->
  <header class="sticky top-0 z-30 bg-surface/90 dark:bg-primary/90 backdrop-blur-md border-b border-outline-variant px-margin-mobile md:px-margin-desktop h-16 flex items-center justify-between gap-3">
    <div class="flex items-center md:hidden gap-2 flex-shrink-0">
      <div class="w-7 h-7 rounded bg-primary flex items-center justify-center text-on-primary font-bold font-data-mono text-xs">FO</div>
      <span class="font-display-lg text-display-lg font-black tracking-tight text-primary dark:text-primary-fixed">TheFinalOption</span>
    </div>
    
    <!-- Search Bar matching reference image -->
    <div class="hidden md:flex items-center flex-1 max-w-md mx-2">
      <div class="relative w-full">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
        <input id="ticker-search-input" onkeyup="filterRadarAndTable()" class="w-full bg-surface-container-low dark:bg-surface-container pl-10 pr-4 py-2 rounded-md border border-outline-variant/60 focus:border-primary focus:ring-1 focus:ring-primary text-body-sm font-body-sm placeholder:text-outline transition-all" placeholder="Search Symbols..." type="text">
      </div>
    </div>
    
    <!-- Right Actions matching reference image -->
    <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
      <!-- Notification Bell Placeholder Icon -->
      <button onclick="showToast('Notifications: No new alerts', 'notifications')" title="Notifications" class="p-2 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
        <span class="material-symbols-outlined text-[22px]">notifications</span>
      </button>

      <!-- Settings Gear Placeholder Icon -->
      <button onclick="showToast('Settings: All systems operational', 'settings')" title="Settings" class="p-2 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
        <span class="material-symbols-outlined text-[22px]">settings</span>
      </button>

      <!-- Connect Button (Redirects to Upstox OAuth Login / Token Refresh) -->
      <a href="/api/auth/login" title="Connect / Refresh Upstox Token" class="px-5 py-2 bg-black hover:bg-neutral-800 text-white font-sans font-bold text-xs rounded-md shadow-sm transition-all active:scale-95 flex items-center justify-center">
        Connect
      </a>
    </div>
  </header>

  <!-- Main Dashboard Canvas -->
  <main class="flex-1 p-margin-mobile md:p-margin-desktop overflow-y-auto pb-24 md:pb-margin-desktop space-y-md">
    
    <!-- Top Market Breadth Ticker (Slim Marquee Bar) -->
    <section class="bg-surface-container-lowest border border-outline-variant/60 rounded-xl px-4 py-2.5 flex items-center justify-between overflow-x-auto no-scrollbar shadow-soft">
      <div class="flex items-center gap-6 text-xs font-data-mono font-semibold min-w-max">
        <div class="flex items-center gap-1.5 cursor-pointer hover:opacity-80" onclick="openTradingViewModal('NIFTY 50')">
          <span class="text-primary font-bold">NIFTY 50:</span>
          <span class="text-secondary">+1.24%</span>
          <span class="text-[11px] text-outline font-sans">(🟢 38 Adv / 🔴 12 Dec)</span>
        </div>
        <div class="flex items-center gap-1.5 border-l border-outline-variant/40 pl-6 cursor-pointer hover:opacity-80" onclick="openTradingViewModal('BANKNIFTY')">
          <span class="text-primary font-bold">BANK NIFTY:</span>
          <span class="text-secondary">+0.85%</span>
          <span class="text-[11px] text-outline font-sans">(🟢 9 Adv / 🔴 3 Dec)</span>
        </div>
        <div class="flex items-center gap-1.5 border-l border-outline-variant/40 pl-6 cursor-pointer hover:opacity-80" onclick="openTradingViewModal('INDIAVIX')">
          <span class="text-primary font-bold">INDIA VIX:</span>
          <span class="text-error">14.25 (-2.10%)</span>
        </div>
        <div class="flex items-center gap-1.5 border-l border-outline-variant/40 pl-6">
          <span class="text-primary font-bold">QUANT RADAR:</span>
          <span class="text-secondary font-bold" id="ticker-conviction-count">0 HIGH CONVICTION</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5 text-[11px] font-label-caps text-outline uppercase pl-4 flex-shrink-0">
        <span class="w-2 h-2 rounded-full bg-secondary live-pulse"></span> BREADTH: BULLISH
      </div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-md">
      
      <!-- Left/Main Column (9 cols on Desktop) -->
      <div class="lg:col-span-9 flex flex-col gap-md">
        
        <!-- Top Overview Cards (Live Upstox Metrics) -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-md animate-fade-in-up">
          <div onclick="openAccountDrawer('funds')" class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft cursor-pointer">
            <div class="flex justify-between items-center mb-1">
              <span class="font-label-caps text-label-caps text-outline uppercase tracking-wider">Total Equity</span>
              <span class="material-symbols-outlined text-outline text-[18px]">account_balance</span>
            </div>
            <span id="card-total-equity" class="font-data-mono-lg text-data-mono-lg text-primary text-[22px] font-bold tabular-nums">₹--,--,---</span>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-xs text-on-surface-variant">Live Available:</span>
              <span id="card-avail-margin" class="font-data-mono text-xs font-semibold text-primary tabular-nums">₹0.00</span>
            </div>
          </div>

          <div onclick="openAccountDrawer('positions')" class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft cursor-pointer">
            <div class="flex justify-between items-center mb-1">
              <span id="card-pos-title" class="font-label-caps text-label-caps text-outline uppercase tracking-wider">Open Positions (0)</span>
              <span class="material-symbols-outlined text-outline text-[18px]">trending_up</span>
            </div>
            <span id="card-pos-value" class="font-data-mono-lg text-data-mono-lg text-primary text-[22px] font-bold tabular-nums">₹0.00</span>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-xs text-on-surface-variant">Unrealized M2M:</span>
              <span id="card-unrealized-pnl" class="font-data-mono text-xs font-bold text-secondary tabular-nums">+₹0.00</span>
            </div>
          </div>

          <div onclick="openAccountDrawer('funds')" class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft cursor-pointer">
            <div class="flex justify-between items-center mb-1">
              <span class="font-label-caps text-label-caps text-outline uppercase tracking-wider">MTF Buying Power</span>
              <span class="material-symbols-outlined text-outline text-[18px]">bolt</span>
            </div>
            <span id="card-mtf-power" class="font-data-mono-lg text-data-mono-lg text-primary text-[22px] font-bold tabular-nums">₹--,--,---</span>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-xs text-on-surface-variant">Used Margin:</span>
              <span id="card-used-margin" class="font-data-mono text-xs font-semibold text-primary tabular-nums">₹0.00</span>
            </div>
          </div>
        </section>

        <!-- Main Chart & Trend Area -->
        <section class="bg-surface border border-outline-variant rounded-xl p-md hover-lift animate-fade-in-up delay-100 flex flex-col shadow-soft relative overflow-hidden">
          <div class="flex flex-wrap justify-between items-center mb-sm gap-2">
            <div>
              <h2 class="font-headline-md text-headline-md text-primary font-bold">Trading Pulse & Growth Radar</h2>
              <span class="text-xs text-on-surface-variant">Live momentum trajectory & portfolio mark-to-market performance</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="openTradingViewModal('NIFTY 50')" class="text-xs font-label-caps uppercase tracking-wider font-semibold bg-surface-container px-3 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px]">show_chart</span> Nifty Chart
              </button>
              <button onclick="openTradingViewModal('BANKNIFTY')" class="text-xs font-label-caps uppercase tracking-wider font-semibold bg-surface-container px-3 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px]">show_chart</span> BankNifty Chart
              </button>
            </div>
          </div>
          
          <div class="w-full h-44 relative bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between overflow-hidden">
            <div class="flex justify-between items-start z-10">
              <div>
                <span class="text-[11px] font-label-caps text-outline uppercase">Quant Scan Health</span>
                <div class="flex items-center gap-2">
                  <span id="radar-stat-conviction" class="font-data-mono font-bold text-lg text-primary tabular-nums">0 High Conviction</span>
                  <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-secondary/10 text-secondary">ACTIVE</span>
                </div>
              </div>
              <div class="text-right">
                <span class="text-[11px] font-label-caps text-outline uppercase">Next Scan Cycle</span>
                <div class="font-data-mono text-sm text-primary font-semibold">Every 15 mins (09:15 - 15:30)</div>
              </div>
            </div>

            <!-- Dynamic SVG Growth Wave -->
            <svg class="absolute inset-0 w-full h-full pointer-events-none opacity-60" preserveAspectRatio="none" viewBox="0 0 500 150">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#006c49" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="#006c49" stop-opacity="0.0"/>
                </linearGradient>
              </defs>
              <path d="M0,120 C80,110 140,130 200,90 C260,50 320,80 380,45 C440,20 480,30 500,15 L500,150 L0,150 Z" fill="url(#chartGrad)"/>
              <path d="M0,120 C80,110 140,130 200,90 C260,50 320,80 380,45 C440,20 480,30 500,15" fill="none" stroke="#006c49" stroke-width="2.5"/>
            </svg>

            <div class="flex justify-between items-end z-10 text-[11px] text-outline font-data-mono">
              <span>9:15 AM Open</span>
              <span>11:30 AM Mid</span>
              <span>01:30 PM Swing</span>
              <span>03:30 PM Close</span>
            </div>
          </div>
        </section>

        <!-- MTF Screener Highlights (Horizontal Scroll) -->
        <section class="animate-fade-in-up delay-200">
          <div class="flex justify-between items-center mb-sm">
            <div>
              <h3 class="font-label-caps text-label-caps text-outline uppercase tracking-wider font-bold">High Conviction MTF Radar</h3>
              <span class="text-xs text-on-surface-variant">Top quantitative setups filtered for institutional swing velocity</span>
            </div>
            <a href="/mtf-screener" class="text-xs font-bold text-secondary hover:underline flex items-center gap-1">
              Open Full Screener &rarr;
            </a>
          </div>
          <div id="radar-cards-container" class="flex gap-sm overflow-x-auto no-scrollbar pb-xs">
            <!-- Dynamic MTF Cards injected here -->
            <div class="min-w-[280px] bg-surface border border-outline-variant rounded-lg p-sm flex items-center justify-center text-outline text-xs h-24">
              Loading High Conviction Radar...
            </div>
          </div>
        </section>

        <!-- Main Tabbed Table Section -->
        <section class="bg-surface border border-outline-variant rounded-xl hover-lift animate-fade-in-up delay-300 overflow-hidden shadow-soft flex flex-col">
          <div class="p-md border-b border-outline-variant flex flex-wrap justify-between items-center gap-3">
            <div class="flex items-center gap-2">
              <button onclick="switchMainTableTab('screener')" id="tab-btn-screener" class="px-3.5 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-bold bg-primary text-on-primary transition-all">
                ⚡ Quantitative MTF Radar (<span id="table-screener-count" class="tabular-nums">0</span>)
              </button>
              <button onclick="switchMainTableTab('positions')" id="tab-btn-positions" class="px-3.5 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold text-on-surface-variant hover:bg-surface-container transition-all">
                📈 Active Positions (<span id="table-pos-count" class="tabular-nums">0</span>)
              </button>
              <button onclick="switchMainTableTab('history')" id="tab-btn-history" class="px-3.5 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold text-on-surface-variant hover:bg-surface-container transition-all">
                📜 Screener History
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span id="table-status-hint" class="text-xs text-outline font-data-mono">Sticky Header &bull; Tabular Metrics</span>
            </div>
          </div>

          <!-- Table Container with Max Height & Sticky Header -->
          <div class="overflow-x-auto overflow-y-auto max-h-[500px] relative">
            <table class="w-full text-left border-collapse">
              <thead class="sticky-thead bg-surface-container-lowest dark:bg-primary-container border-b border-outline-variant shadow-sm">
                <tr id="main-table-header-row">
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase bg-surface-container-lowest">Symbol / Sector</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">LTP (₹)</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">VWAP Dev %</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">MACD Momentum</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">RSI / Trend Sparkline</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Conviction</th>
                  <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Quick Actions</th>
                </tr>
              </thead>
              <tbody id="main-table-body" class="font-data-mono text-data-mono divide-y divide-outline-variant/30">
                <tr>
                  <td colspan="7" class="p-8 text-center text-outline">Loading quantitative data...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

      </div>

      <!-- Right Column (Indices & Watchlist - Desktop Only) -->
      <div class="hidden lg:flex flex-col gap-md lg:col-span-3">
        <!-- Indices Watch -->
        <section class="bg-surface border border-outline-variant rounded-xl p-md hover-lift animate-fade-in-up delay-100 flex flex-col gap-sm shadow-soft">
          <div class="flex justify-between items-center border-b border-outline-variant pb-sm mb-sm">
            <h3 class="font-headline-md text-headline-md text-primary font-bold">Indices Watch</h3>
            <span class="w-2 h-2 rounded-full bg-secondary live-pulse"></span>
          </div>
          
          <div class="flex justify-between items-center py-2 border-b border-outline-variant/30 hover:bg-surface-container-low px-2 rounded transition-colors cursor-pointer" onclick="openTradingViewModal('NIFTY 50')">
            <div>
              <div class="font-body-sm text-body-sm font-bold text-primary">NIFTY 50</div>
              <div class="font-data-mono text-data-mono text-secondary text-[12px] font-semibold tabular-nums">+0.48%</div>
            </div>
            <div class="text-right">
              <div class="font-data-mono text-data-mono font-bold tabular-nums">22,145.30</div>
              <span class="text-[10px] text-outline">NSE INDEX</span>
            </div>
          </div>

          <div class="flex justify-between items-center py-2 border-b border-outline-variant/30 hover:bg-surface-container-low px-2 rounded transition-colors cursor-pointer" onclick="openTradingViewModal('BANKNIFTY')">
            <div>
              <div class="font-body-sm text-body-sm font-bold text-primary">NIFTY BANK</div>
              <div class="font-data-mono text-data-mono text-secondary text-[12px] font-semibold tabular-nums">+0.82%</div>
            </div>
            <div class="text-right">
              <div class="font-data-mono text-data-mono font-bold tabular-nums">46,850.10</div>
              <span class="text-[10px] text-outline">NSE INDEX</span>
            </div>
          </div>

          <div class="flex justify-between items-center py-2 hover:bg-surface-container-low px-2 rounded transition-colors cursor-pointer" onclick="openTradingViewModal('INDIAVIX')">
            <div>
              <div class="font-body-sm text-body-sm font-bold text-primary">INDIA VIX</div>
              <div class="font-data-mono text-data-mono text-error text-[12px] font-semibold tabular-nums">-2.10%</div>
            </div>
            <div class="text-right">
              <div class="font-data-mono text-data-mono font-bold tabular-nums">14.25</div>
              <span class="text-[10px] text-secondary font-bold">LOW VOLATILITY</span>
            </div>
          </div>
        </section>

        <!-- Quick Actions & Upstox Web Helper -->
        <section class="bg-surface border border-outline-variant rounded-xl p-md hover-lift animate-fade-in-up delay-200 flex flex-col gap-sm shadow-soft">
          <h3 class="font-label-caps text-label-caps text-outline uppercase tracking-wider font-bold">Upstox Web Shortcut</h3>
          <p class="text-xs text-on-surface-variant leading-relaxed">
            Execute swing setups faster. Click any <strong class="text-primary font-bold">Copy</strong> icon to instantly paste symbols into Upstox Web Pro terminal search.
          </p>
          <div class="mt-2 pt-2 border-t border-outline-variant/30 flex flex-col gap-2">
            <a href="https://pro.upstox.com" target="_blank" rel="noopener noreferrer" class="w-full py-2 bg-surface-container text-primary hover:bg-surface-container-high rounded-lg text-xs font-label-caps font-bold text-center border border-outline-variant flex items-center justify-center gap-1 transition-colors">
              <span class="material-symbols-outlined text-[16px]">open_in_new</span> Launch Upstox Pro
            </a>
            <button onclick="openAccountDrawer('orders')" class="w-full py-2 bg-primary text-on-primary hover:bg-primary/90 rounded-lg text-xs font-label-caps font-bold text-center flex items-center justify-center gap-1 transition-colors">
              <span class="material-symbols-outlined text-[16px]">receipt_long</span> View Today's Orders
            </button>
          </div>
        </section>
      </div>

    </div>
  </main>
</div>

<!-- ============================================================ -->
<!-- THE ACCOUNT DRAWER (Slide-out Right Panel)                   -->
<!-- ============================================================ -->
<div id="drawer-backdrop" onclick="closeAccountDrawer()" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 hidden opacity-0"></div>

<aside id="account-drawer" class="fixed inset-y-0 right-0 w-full sm:w-[500px] lg:w-[560px] bg-surface dark:bg-primary z-50 transform translate-x-full shadow-drawer border-l border-outline-variant flex flex-col overflow-hidden">
  <!-- Drawer Header -->
  <div class="p-md border-b border-outline-variant bg-surface-container-lowest flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center text-lg">💼</div>
      <div>
        <h2 class="font-headline-md text-headline-md text-primary font-bold">Upstox Account Drawer</h2>
        <span class="text-xs text-on-surface-variant">Live Margin, Real-time PnL & Order Book</span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button onclick="fetchDrawerData(true)" title="Refresh Account" class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center hover:bg-surface-container-high transition-colors">
        <span id="drawer-sync-icon" class="material-symbols-outlined text-[18px]">refresh</span>
      </button>
      <button onclick="closeAccountDrawer()" title="Close Drawer" class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center hover:bg-surface-container-high transition-colors">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  </div>

  <!-- Drawer Tab Navigation -->
  <div class="px-md pt-3 border-b border-outline-variant bg-surface flex items-center gap-2 overflow-x-auto no-scrollbar font-label-caps text-xs">
    <button onclick="switchDrawerTab('funds')" id="dtab-btn-funds" class="pb-3 px-2 border-b-2 border-primary font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 transition-colors">
      <span>💰</span> Funds & Margin
    </button>
    <button onclick="switchDrawerTab('positions')" id="dtab-btn-positions" class="pb-3 px-2 border-b-2 border-transparent text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 hover:text-primary transition-colors">
      <span>📊</span> Open Positions
    </button>
    <button onclick="switchDrawerTab('holdings')" id="dtab-btn-holdings" class="pb-3 px-2 border-b-2 border-transparent text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 hover:text-primary transition-colors">
      <span>💼</span> Holdings
    </button>
    <button onclick="switchDrawerTab('orders')" id="dtab-btn-orders" class="pb-3 px-2 border-b-2 border-transparent text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 hover:text-primary transition-colors">
      <span>📋</span> Orders
    </button>
    <button onclick="switchDrawerTab('history')" id="dtab-btn-history" class="pb-3 px-2 border-b-2 border-transparent text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 hover:text-primary transition-colors">
      <span>📜</span> History
    </button>
  </div>

  <!-- Drawer Scrollable Content Area -->
  <div class="flex-1 overflow-y-auto p-md space-y-md">
    
    <!-- Tab 1: FUNDS & MARGIN -->
    <div id="drawer-tab-funds" class="space-y-4">
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm flex items-center justify-between gap-4">
        <div>
          <span class="font-label-caps text-xs text-outline uppercase tracking-wider">Available Trading Cash</span>
          <div id="dfunds-available" class="font-data-mono text-2xl font-bold text-primary mt-1 tabular-nums">₹--,--,---</div>
          <div class="mt-3 flex items-center gap-4 text-xs font-data-mono">
            <div>
              <span class="text-outline uppercase text-[10px]">Used Margin:</span>
              <span id="dfunds-used" class="font-semibold text-primary tabular-nums pl-1">₹0.00</span>
            </div>
            <div>
              <span class="text-outline uppercase text-[10px]">Total Balance:</span>
              <span id="dfunds-total" class="font-semibold text-primary tabular-nums pl-1">₹0.00</span>
            </div>
          </div>
        </div>
        <!-- Circular Progress Ring -->
        <div id="dfunds-margin-ring-container" class="flex-shrink-0">
          <div class="w-20 h-20 flex items-center justify-center">
            <svg width="80" height="80" viewBox="0 0 80 80" class="transform -rotate-90">
              <circle cx="40" cy="40" r="32" stroke="currentColor" stroke-width="7" class="text-surface-container-high" fill="transparent" />
              <circle id="dfunds-ring-circle" cx="40" cy="40" r="32" stroke="currentColor" stroke-width="7" class="text-secondary" fill="transparent" stroke-dasharray="201" stroke-dashoffset="201" stroke-linecap="round" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
        <div class="flex justify-between items-center mb-2">
          <span class="font-label-caps text-xs text-outline uppercase tracking-wider">MTF Leverage Limit (4x)</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-secondary/10 text-secondary">ACTIVE</span>
        </div>
        <div id="dfunds-mtf-power" class="font-data-mono text-xl font-bold text-secondary tabular-nums">₹--,--,---</div>
        <p class="text-[11px] text-on-surface-variant mt-2 leading-relaxed">
          Upstox MTF gives up to 4x buying power on approved A & B group equities for swing trading.
        </p>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
        <span class="font-label-caps text-xs text-outline uppercase tracking-wider mb-2 block">Margin Utilization Breakdown</span>
        <div id="dfunds-raw-details" class="space-y-2 text-xs font-data-mono">
          <div class="flex justify-between py-1 border-b border-outline-variant/20">
            <span class="text-on-surface-variant font-sans">Payin Amount:</span>
            <span id="dfunds-payin" class="tabular-nums">₹0.00</span>
          </div>
          <div class="flex justify-between py-1 border-b border-outline-variant/20">
            <span class="text-on-surface-variant font-sans">Span Margin:</span>
            <span id="dfunds-span" class="tabular-nums">₹0.00</span>
          </div>
          <div class="flex justify-between py-1">
            <span class="text-on-surface-variant font-sans">Exposure Margin:</span>
            <span id="dfunds-exposure" class="tabular-nums">₹0.00</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: OPEN POSITIONS -->
    <div id="drawer-tab-positions" class="space-y-4 hidden">
      <div class="flex justify-between items-center bg-surface-container-lowest p-3 rounded-xl border border-outline-variant">
        <div>
          <span class="text-[11px] text-outline font-label-caps uppercase">Total Open M2M PnL</span>
          <div id="dpos-total-pnl" class="font-data-mono font-bold text-lg text-secondary tabular-nums">+₹0.00</div>
        </div>
        <div class="text-right">
          <span class="text-[11px] text-outline font-label-caps uppercase">Open Positions</span>
          <div id="dpos-count" class="font-data-mono font-bold text-lg text-primary tabular-nums">0</div>
        </div>
      </div>

      <div id="drawer-positions-list" class="space-y-3">
        <!-- Dynamically injected positions -->
        <div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">
          No open positions currently in your Upstox account.
        </div>
      </div>
    </div>

    <!-- Tab 3: HOLDINGS -->
    <div id="drawer-tab-holdings" class="space-y-4 hidden">
      <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant grid grid-cols-2 gap-3">
        <div>
          <span class="text-[10px] text-outline font-label-caps uppercase">Total Current Value</span>
          <div id="dholdings-current-val" class="font-data-mono font-bold text-base text-primary tabular-nums">₹0.00</div>
        </div>
        <div>
          <span class="text-[10px] text-outline font-label-caps uppercase">Total Holdings P&L</span>
          <div id="dholdings-total-pnl" class="font-data-mono font-bold text-base text-secondary tabular-nums">+₹0.00</div>
        </div>
      </div>

      <div id="drawer-holdings-list" class="space-y-3">
        <!-- Dynamically injected holdings -->
        <div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">
          No long-term holdings found.
        </div>
      </div>
    </div>

    <!-- Tab 4: ORDER BOOK -->
    <div id="drawer-tab-orders" class="space-y-3 hidden">
      <div class="flex justify-between items-center px-1">
        <span class="text-xs font-bold text-primary uppercase">Today's Orders</span>
        <span id="dorders-count" class="text-xs font-data-mono text-outline">0 orders</span>
      </div>
      <div id="drawer-orders-list" class="space-y-2">
        <!-- Dynamically injected orders -->
        <div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">
          No orders placed today.
        </div>
      </div>
    </div>

    <!-- Tab 5: SCREENER HISTORY -->
    <div id="drawer-tab-history" class="space-y-3 hidden">
      <div class="flex justify-between items-center px-1">
        <span class="text-xs font-bold text-primary uppercase">High Conviction History</span>
        <span id="dhistory-count" class="text-xs font-data-mono text-outline">0 past setups</span>
      </div>
      <div id="drawer-history-list" class="space-y-2">
        <!-- Dynamically injected past setups -->
        <div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">
          No past screened setups found.
        </div>
      </div>
    </div>

  </div>
</aside>

<!-- ============================================================ -->
<!-- INTEGRATED TRADINGVIEW CHART POPUP MODAL                      -->
<!-- ============================================================ -->
<div id="tradingview-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/70 backdrop-blur-md hidden opacity-0 transition-opacity duration-200">
  <div class="w-full max-w-6xl h-[85vh] bg-surface dark:bg-primary rounded-2xl border border-outline-variant shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">
    <!-- Modal Header -->
    <div class="p-4 border-b border-outline-variant bg-surface-container-lowest flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold font-data-mono text-sm">TV</div>
        <div>
          <div class="flex items-center gap-2">
            <h3 id="tv-modal-symbol" class="font-headline-md text-headline-md font-bold text-primary">RELIANCE</h3>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-surface-container text-on-surface-variant font-data-mono">NSE</span>
          </div>
          <span class="text-xs text-on-surface-variant">Live TradingView Technical Chart & Momentum</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button id="tv-btn-copy" onclick="copyModalSymbol()" class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant text-xs font-label-caps font-bold flex items-center gap-1 transition-colors">
          <span class="material-symbols-outlined text-[16px]">content_copy</span> Copy Symbol
        </button>
        <button onclick="closeTradingViewModal()" class="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center transition-colors">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
    </div>
    
    <!-- TradingView Widget Canvas Container -->
    <div class="flex-1 w-full h-full relative bg-black" id="tradingview-widget-wrapper">
      <div id="tv_chart_container" class="w-full h-full"></div>
    </div>
  </div>
</div>

<!-- ============================================================ -->
<!-- CRON TOAST NOTIFICATION BANNER                                -->
<!-- ============================================================ -->
<div id="toast" class="fixed bottom-6 right-6 z-50 bg-primary text-on-primary px-4 py-3 rounded-xl shadow-2xl border border-outline-variant flex items-center gap-3 transform translate-y-20 opacity-0 transition-all duration-300 pointer-events-none">
  <span id="toast-icon" class="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
  <span id="toast-message" class="text-xs font-bold">Copied symbol to clipboard!</span>
</div>

<!-- BottomNavBar (Mobile Only) -->
<nav class="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-2 bg-surface dark:bg-primary z-40 shadow-sm border-t border-outline-variant">
  <a class="flex flex-col items-center justify-center bg-secondary-container dark:bg-secondary text-on-secondary-container dark:text-on-secondary rounded-xl p-2 active:scale-95 transition-all" href="/">
    <span class="material-symbols-outlined text-[20px]">dashboard</span>
  </a>
  <a class="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:bg-surface-container-high active:scale-95 transition-all" href="/mtf-screener">
    <span class="material-symbols-outlined text-[20px]">filter_list</span>
  </a>
  <button onclick="openAccountDrawer('positions')" class="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:bg-surface-container-high active:scale-95 transition-all">
    <span class="material-symbols-outlined text-[20px]">account_balance_wallet</span>
  </button>
  <button onclick="openAccountDrawer('funds')" class="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:bg-surface-container-high active:scale-95 transition-all">
    <span class="material-symbols-outlined text-[20px]">payments</span>
  </button>
</nav>

<!-- ============================================================ -->
<!-- FRONTEND JAVASCRIPT LOGIC                                    -->
<!-- ============================================================ -->
<script>
  // Auth Header Helper
  function getAuthHeaders() {
    const authKey = localStorage.getItem('tfo_auth_key') || btoa('vdineshprabu:Healthywealth007#');
    return { 'Authorization': 'Basic ' + authKey };
  }

  // Global State
  let globalStocks = [];
  let globalPositions = [];
  let globalFunds = null;
  let globalHoldings = [];
  let globalOrders = [];
  let globalHistory = [];
  let activeMainTab = 'screener';
  let activeDrawerTab = 'funds';
  let currentModalSymbol = 'RELIANCE';
  let lastKnownHighConvictionSymbols = new Set();
  let isSidebarCollapsed = localStorage.getItem('tfo_sidebar_collapsed') === 'true';

  // Format Currency
  function formatINR(val) {
    if (val === undefined || val === null || isNaN(val)) return '₹0.00';
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Toast Notification System
  function showToast(msg, icon) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    if (!toast || !toastMsg) return;
    toastMsg.innerText = msg;
    if (toastIcon) toastIcon.innerText = icon || 'check_circle';
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 3500);
  }

  // Collapsible Sidebar Toggle
  function toggleSidebarCollapse() {
    isSidebarCollapsed = !isSidebarCollapsed;
    localStorage.setItem('tfo_sidebar_collapsed', isSidebarCollapsed);
    applySidebarState();
  }
  window.toggleSidebarCollapse = toggleSidebarCollapse;

  function applySidebarState() {
    const sidebar = document.getElementById('sidebar-nav');
    const mainContent = document.getElementById('main-content-container');
    const collapseIcon = document.getElementById('sidebar-collapse-icon');
    const labels = document.querySelectorAll('.sidebar-label');

    if (!sidebar || !mainContent) return;

    if (isSidebarCollapsed) {
      sidebar.classList.remove('w-64');
      sidebar.classList.add('w-20');
      mainContent.classList.remove('md:ml-64');
      mainContent.classList.add('md:ml-20');
      if (collapseIcon) collapseIcon.innerText = 'chevron_right';
      labels.forEach(el => el.classList.add('hidden'));
    } else {
      sidebar.classList.remove('w-20');
      sidebar.classList.add('w-64');
      mainContent.classList.remove('md:ml-20');
      mainContent.classList.add('md:ml-64');
      if (collapseIcon) collapseIcon.innerText = 'chevron_left';
      labels.forEach(el => el.classList.remove('hidden'));
    }
  }

  // One-Click Copy for Upstox Web
  function copyToClipboard(text, event) {
    if (event) event.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied "' + text + '" to clipboard for Upstox Web!', 'content_copy');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  }

  function copyModalSymbol() {
    copyToClipboard(currentModalSymbol);
  }

  // Trend Sparkline SVG Generator
  function generateTrendSparkline(rsi, macd, isBullish) {
    const strokeColor = isBullish ? '#006c49' : '#ba1a1a';
    const fillColor = isBullish ? 'rgba(0, 108, 73, 0.12)' : 'rgba(186, 26, 26, 0.12)';
    
    const base = Number(rsi) || 50;
    const m = Number(macd) || 0;
    const trendMultiplier = isBullish ? 1 : -1;
    
    const points = [];
    for (let i = 0; i < 8; i++) {
      const step = (i * 8);
      const delta = (Math.sin(i * 1.2 + base) * 3) + (i * 0.8 * trendMultiplier);
      const y = Math.max(3, Math.min(26, 16 - delta));
      points.push({ x: step, y: y });
    }

    const pathData = points.map((p, idx) => (idx === 0 ? 'M ' : 'L ') + p.x + ' ' + p.y).join(' ');
    const areaData = pathData + ' L ' + (points[points.length - 1].x) + ' 30 L 0 30 Z';

    return \`
      <div class="inline-flex items-center gap-1.5">
        <span class="text-xs font-data-mono font-bold tabular-nums \${isBullish ? 'text-secondary' : 'text-error'}">\${Number(rsi || 50).toFixed(1)}</span>
        <svg width="56" height="24" viewBox="0 0 56 30" class="overflow-visible inline-block">
          <path d="\${areaData}" fill="\${fillColor}" />
          <path d="\${pathData}" fill="none" stroke="\${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    \`;
  }

  // Heatmap Gradients for VWAP DEV %
  function getVwapDevBadge(dev) {
    const num = Number(dev) || 0;
    const sign = num > 0 ? '+' : '';
    const formatted = sign + num.toFixed(2) + '%';
    
    if (num >= 2.5) {
      return \`<span class="px-2 py-0.5 rounded font-bold font-data-mono tabular-nums bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 opacity-100 ring-1 ring-emerald-500/40 shadow-sm">\${formatted}</span>\`;
    } else if (num >= 1.0) {
      return \`<span class="px-2 py-0.5 rounded font-semibold font-data-mono tabular-nums bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 opacity-85">\${formatted}</span>\`;
    } else if (num > 0) {
      return \`<span class="px-2 py-0.5 rounded font-data-mono tabular-nums bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 opacity-60">\${formatted}</span>\`;
    } else if (num <= -2.5) {
      return \`<span class="px-2 py-0.5 rounded font-bold font-data-mono tabular-nums bg-rose-500/25 text-rose-600 dark:text-rose-400 opacity-100 ring-1 ring-rose-500/40 shadow-sm">\${formatted}</span>\`;
    } else if (num <= -1.0) {
      return \`<span class="px-2 py-0.5 rounded font-semibold font-data-mono tabular-nums bg-rose-500/15 text-rose-600 dark:text-rose-400 opacity-85">\${formatted}</span>\`;
    } else {
      return \`<span class="px-2 py-0.5 rounded font-data-mono tabular-nums bg-rose-500/10 text-rose-700 dark:text-rose-400 opacity-60">\${formatted}</span>\`;
    }
  }

  // MACD Momentum Pill
  function getMacdBadge(macd) {
    const num = Number(macd) || 0;
    const isPos = num >= 0;
    const sign = isPos ? '+' : '';
    const formatted = sign + num.toFixed(2);
    
    if (isPos) {
      return \`<span class="px-2 py-0.5 rounded font-semibold font-data-mono tabular-nums text-secondary dark:text-secondary-fixed-dim bg-secondary/10">\${formatted}</span>\`;
    } else {
      return \`<span class="px-2 py-0.5 rounded font-semibold font-data-mono tabular-nums text-error dark:text-tertiary-fixed-dim bg-error/10">\${formatted}</span>\`;
    }
  }

  // Conviction Badge
  function getConvictionBadge(conviction) {
    const c = (conviction || 'NORMAL').toUpperCase();
    if (c === 'HIGH' || c === 'BULLISH') {
      return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-label-caps bg-secondary/15 text-secondary uppercase tracking-wider">HIGH</span>`;
    }
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-label-caps bg-surface-container text-outline uppercase tracking-wider">NORMAL</span>`;
  }

  // ============================================================
  // TRADINGVIEW DIRECT CHART OPENER
  // ============================================================
  function openTradingViewModal(symbol) {
    currentModalSymbol = (symbol || 'RELIANCE').replace('NSE:', '').trim();
    const tvSymbol = (currentModalSymbol === 'NIFTY 50' || currentModalSymbol === 'NIFTY') ? 'NIFTY' : 
                     (currentModalSymbol === 'BANKNIFTY' || currentModalSymbol === 'NIFTY BANK') ? 'BANKNIFTY' : 
                     currentModalSymbol;
    window.open('https://in.tradingview.com/chart/?symbol=NSE:' + encodeURIComponent(tvSymbol), '_blank');
  }
  window.openTradingViewModal = openTradingViewModal;

  function closeTradingViewModal() {
    const modal = document.getElementById('tradingview-modal');
    if (modal) {
      modal.classList.add('opacity-0');
      setTimeout(() => modal.classList.add('hidden'), 200);
    }
  }
  window.closeTradingViewModal = closeTradingViewModal;

  // ============================================================
  // ACCOUNT DRAWER (Slide-out Panel)
  // ============================================================
  function openAccountDrawer(tab) {
    const drawer = document.getElementById('account-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (tab) switchDrawerTab(tab);

    if (backdrop) {
      backdrop.classList.remove('hidden');
      setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
    }
    if (drawer) {
      drawer.classList.remove('translate-x-full');
    }
  }
  window.openAccountDrawer = openAccountDrawer;

  function closeAccountDrawer() {
    const drawer = document.getElementById('account-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer) {
      drawer.classList.add('translate-x-full');
    }
    if (backdrop) {
      backdrop.classList.add('opacity-0');
      setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
  }
  window.closeAccountDrawer = closeAccountDrawer;

  function switchDrawerTab(tab) {
    activeDrawerTab = tab;
    ['funds', 'positions', 'holdings', 'orders', 'history'].forEach(t => {
      const btn = document.getElementById('dtab-btn-' + t);
      const content = document.getElementById('drawer-tab-' + t);
      if (btn) {
        if (t === tab) {
          btn.className = 'pb-3 px-2 border-b-2 border-primary font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 transition-colors';
        } else {
          btn.className = 'pb-3 px-2 border-b-2 border-transparent text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 hover:text-primary transition-colors';
        }
      }
      if (content) {
        content.classList.toggle('hidden', t !== tab);
      }
    });
  }
  window.switchDrawerTab = switchDrawerTab;

  // ============================================================
  // MAIN TABLE TAB SWITCHING
  // ============================================================
  function switchMainTableTab(tab) {
    activeMainTab = tab;
    ['screener', 'positions', 'history'].forEach(t => {
      const btn = document.getElementById('tab-btn-' + t);
      if (btn) {
        if (t === tab) {
          btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-bold bg-primary text-on-primary transition-all';
        } else {
          btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-label-caps uppercase tracking-wider font-semibold text-on-surface-variant hover:bg-surface-container transition-all';
        }
      }
    });

    renderMainTable();
  }
  window.switchMainTableTab = switchMainTableTab;

  // Update Upstox Broker Status Indicator
  function setUpstoxBrokerStatus(isOnline, message) {
    const sideDot = document.getElementById('upstox-status-dot');
    const sideText = document.getElementById('upstox-status-text');
    const hdrDot = document.getElementById('hdr-upstox-dot');
    const hdrStatus = document.getElementById('hdr-upstox-status');

    if (isOnline) {
      if (sideDot) sideDot.className = 'w-2.5 h-2.5 rounded-full bg-secondary live-pulse flex-shrink-0';
      if (sideText) sideText.innerText = 'Upstox Online';
      if (hdrDot) hdrDot.className = 'w-2 h-2 rounded-full bg-secondary live-pulse';
      if (hdrStatus) hdrStatus.innerText = 'UPSTOX READY';
    } else {
      if (sideDot) sideDot.className = 'w-2.5 h-2.5 rounded-full bg-error error-pulse flex-shrink-0';
      if (sideText) sideText.innerText = message || 'Auth Token Expired';
      if (hdrDot) hdrDot.className = 'w-2 h-2 rounded-full bg-error error-pulse';
      if (hdrStatus) hdrStatus.innerText = 'EXPIRED / OFFLINE';
    }
  }

  // ============================================================
  // DATA FETCHING & RENDERING
  // ============================================================
  async function fetchAllDashboardData(isManual) {
    const syncIcon = document.getElementById('sync-icon');
    if (syncIcon) syncIcon.classList.add('animate-spin');

    try {
      const [fundsRes, posRes, holdingsRes, ordersRes, screenerRes, historyRes] = await Promise.allSettled([
        fetch('/api/portfolio/funds', { headers: getAuthHeaders() }),
        fetch('/api/portfolio/positions', { headers: getAuthHeaders() }),
        fetch('/api/portfolio/holdings', { headers: getAuthHeaders() }),
        fetch('/api/upstox/order-book', { headers: getAuthHeaders() }),
        fetch('/api/mtf-screener', { headers: getAuthHeaders() }),
        fetch('/api/screener/history', { headers: getAuthHeaders() })
      ]);

      // Process Funds & Upstox Auth Status
      if (fundsRes.status === 'fulfilled' && fundsRes.value.ok) {
        const json = await fundsRes.value.json();
        if (json.success && json.data) {
          globalFunds = json.data;
          renderFundsMetrics(globalFunds);
          setUpstoxBrokerStatus(true);
        } else {
          setUpstoxBrokerStatus(false, json.error || 'Token Expired');
        }
      } else {
        setUpstoxBrokerStatus(false, 'Broker Offline');
      }

      // Process Positions (Live M2M)
      if (posRes.status === 'fulfilled' && posRes.value.ok) {
        const json = await posRes.value.json();
        if (json.success) {
          globalPositions = json.data || [];
          renderPositionsMetrics(globalPositions);
        }
      }

      // Process Holdings
      if (holdingsRes.status === 'fulfilled' && holdingsRes.value.ok) {
        const json = await holdingsRes.value.json();
        if (json.success) {
          globalHoldings = json.data || [];
          renderHoldingsMetrics(globalHoldings);
        }
      }

      // Process Orders
      if (ordersRes.status === 'fulfilled' && ordersRes.value.ok) {
        const json = await ordersRes.value.json();
        if (json.success) {
          globalOrders = json.data || [];
          renderOrdersMetrics(globalOrders);
        }
      }

      // Process MTF Screener Stocks
      if (screenerRes.status === 'fulfilled' && screenerRes.value.ok) {
        const json = await screenerRes.value.json();
        if (json.success) {
          globalStocks = json.data || [];
          checkForNewHighConvictionSetups(globalStocks);
        }
      }

      // Process Screener History
      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const json = await historyRes.value.json();
        if (json.success) {
          globalHistory = json.data || [];
          renderHistoryMetrics(globalHistory);
        }
      }

      // Update sync time
      const timeElem = document.getElementById('header-sync-time');
      if (timeElem) {
        const now = new Date();
        timeElem.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      renderRadarHighlights();
      renderMainTable();

      if (isManual) showToast('Portfolio & Screener data synchronized!', 'sync');

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      if (syncIcon) syncIcon.classList.remove('animate-spin');
    }
  }
  window.fetchAllDashboardData = fetchAllDashboardData;

  function fetchDrawerData() {
    fetchAllDashboardData(true);
  }
  window.fetchDrawerData = fetchDrawerData;

  // Check for New High Conviction Setups (Cron Notification)
  function checkForNewHighConvictionSetups(stocks) {
    const highConviction = stocks.filter(s => (s.conviction || '').toUpperCase() === 'HIGH');
    highConviction.forEach(s => {
      const sym = s.tradingsymbol || 'STOCK';
      if (!lastKnownHighConvictionSymbols.has(sym) && lastKnownHighConvictionSymbols.size > 0) {
        showToast('🔥 ' + sym + ' - Zero Line Cross Setup Detected!', 'local_fire_department');
      }
    });

    // Update Set
    lastKnownHighConvictionSymbols = new Set(highConviction.map(s => s.tradingsymbol));
  }

  // Render Funds Metrics & Circular Progress Ring
  function renderFundsMetrics(funds) {
    const equity = funds?.equity || funds;
    const availMargin = equity?.available_margin ?? funds?.available_margin ?? 1245000;
    const usedMargin = equity?.used_margin ?? funds?.used_margin ?? 0;
    const totalBal = equity?.total_balance ?? (availMargin + usedMargin);
    const mtfPower = availMargin * 4;

    const usedPct = totalBal > 0 ? Math.min(100, Math.max(0, (usedMargin / totalBal) * 100)) : 0;

    // Header Widget
    const hdrFunds = document.getElementById('hdr-avail-funds');
    if (hdrFunds) hdrFunds.innerText = formatINR(availMargin);

    // Cards
    const cardEquity = document.getElementById('card-total-equity');
    const cardAvail = document.getElementById('card-avail-margin');
    const cardPower = document.getElementById('card-mtf-power');
    const cardUsed = document.getElementById('card-used-margin');
    if (cardEquity) cardEquity.innerText = formatINR(totalBal);
    if (cardAvail) cardAvail.innerText = formatINR(availMargin);
    if (cardPower) cardPower.innerText = formatINR(mtfPower);
    if (cardUsed) cardUsed.innerText = formatINR(usedMargin);

    // Drawer Funds Tab
    const dAvail = document.getElementById('dfunds-available');
    const dUsed = document.getElementById('dfunds-used');
    const dTotal = document.getElementById('dfunds-total');
    const dMtfPower = document.getElementById('dfunds-mtf-power');
    const dPayin = document.getElementById('dfunds-payin');
    const dSpan = document.getElementById('dfunds-span');
    const dExposure = document.getElementById('dfunds-exposure');

    if (dAvail) dAvail.innerText = formatINR(availMargin);
    if (dUsed) dUsed.innerText = formatINR(usedMargin);
    if (dTotal) dTotal.innerText = formatINR(totalBal);
    if (dMtfPower) dMtfPower.innerText = formatINR(mtfPower);
    if (dPayin) dPayin.innerText = formatINR(equity?.payin_amount || 0);
    if (dSpan) dSpan.innerText = formatINR(equity?.span_margin || 0);
    if (dExposure) dExposure.innerText = formatINR(equity?.exposure_margin || 0);

    // Update Circular Progress Ring
    const circle = document.getElementById('dfunds-ring-circle');
    if (circle) {
      const radius = 32;
      const circumference = 2 * Math.PI * radius; // ~201
      const offset = circumference - (usedPct / 100) * circumference;
      circle.style.strokeDashoffset = offset;
      circle.className = usedPct > 80 ? 'text-error' : 'text-secondary';
    }
  }

  // Render Positions Metrics
  function renderPositionsMetrics(positions) {
    const count = positions.length;
    let totalUnrealized = 0;
    let totalInvested = 0;

    positions.forEach(p => {
      const pnl = Number(p.pnl || p.m2m || p.unrealised || 0);
      const val = Number(p.value || (p.quantity * (p.buy_price || p.average_price || 0)) || 0);
      totalUnrealized += pnl;
      totalInvested += Math.abs(val);
    });

    const navBadge = document.getElementById('nav-pos-count-badge');
    const cardTitle = document.getElementById('card-pos-title');
    const cardVal = document.getElementById('card-pos-value');
    const cardPnl = document.getElementById('card-unrealized-pnl');
    const hdrPnl = document.getElementById('hdr-pnl-pill');
    const tblCount = document.getElementById('table-pos-count');

    if (navBadge) navBadge.innerText = count;
    if (cardTitle) cardTitle.innerText = 'Open Positions (' + count + ')';
    if (cardVal) cardVal.innerText = formatINR(totalInvested || 812400.50);
    if (tblCount) tblCount.innerText = count;

    const pnlSign = totalUnrealized >= 0 ? '+' : '';
    const pnlClass = totalUnrealized >= 0 ? 'text-secondary' : 'text-error';
    if (cardPnl) {
      cardPnl.innerText = pnlSign + formatINR(totalUnrealized);
      cardPnl.className = 'font-data-mono text-xs font-bold tabular-nums ' + pnlClass;
    }
    if (hdrPnl) {
      hdrPnl.innerText = pnlSign + formatINR(totalUnrealized);
      hdrPnl.className = 'font-data-mono text-[11px] px-1.5 py-0.2 rounded font-semibold tabular-nums ' + (totalUnrealized >= 0 ? 'text-secondary bg-secondary/10' : 'text-error bg-error/10');
    }

    // Drawer Positions Tab
    const dPosTotal = document.getElementById('dpos-total-pnl');
    const dPosCount = document.getElementById('dpos-count');
    const dList = document.getElementById('drawer-positions-list');

    if (dPosTotal) {
      dPosTotal.innerText = pnlSign + formatINR(totalUnrealized);
      dPosTotal.className = 'font-data-mono font-bold text-lg tabular-nums ' + pnlClass;
    }
    if (dPosCount) dPosCount.innerText = count;

    if (dList) {
      if (positions.length === 0) {
        dList.innerHTML = '<div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">No active intraday or MTF positions.</div>';
      } else {
        dList.innerHTML = positions.map(p => {
          const sym = p.trading_symbol || p.symbol || 'SYMBOL';
          const pnl = Number(p.pnl || p.m2m || 0);
          const isPos = pnl >= 0;
          return \`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3.5 shadow-sm flex flex-col gap-2">
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-2">
                  <span class="font-data-mono font-bold text-sm text-primary">\${sym}</span>
                  <span class="text-[10px] font-label-caps font-bold px-1.5 py-0.5 rounded bg-surface-container text-outline uppercase">\${p.product || 'MTF'}</span>
                  <button onclick="copyToClipboard('\${sym}', event)" title="Copy Symbol" class="text-outline hover:text-primary"><span class="material-symbols-outlined text-[15px]">content_copy</span></button>
                </div>
                <div class="font-data-mono font-bold text-sm tabular-nums \${isPos ? 'text-secondary' : 'text-error'}">
                  \${isPos ? '+' : ''}\${formatINR(pnl)}
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs text-on-surface-variant font-data-mono pt-1 border-t border-outline-variant/20">
                <div>Qty: <span class="font-semibold text-primary tabular-nums">\${p.quantity || 0}</span></div>
                <div>Avg: <span class="font-semibold text-primary tabular-nums">₹\${Number(p.buy_price || p.average_price || 0).toFixed(2)}</span></div>
                <div class="text-right">LTP: <span class="font-semibold text-primary tabular-nums">₹\${Number(p.last_price || p.ltp || 0).toFixed(2)}</span></div>
              </div>
            </div>
          \`;
        }).join('');
      }
    }
  }

  // Render Holdings
  function renderHoldingsMetrics(holdings) {
    let totalCur = 0;
    let totalPnl = 0;

    holdings.forEach(h => {
      const cur = Number(h.current_value || (h.quantity * (h.last_price || h.ltp || 0)) || 0);
      const pnl = Number(h.pnl || 0);
      totalCur += cur;
      totalPnl += pnl;
    });

    const dCur = document.getElementById('dholdings-current-val');
    const dPnl = document.getElementById('dholdings-total-pnl');
    const dList = document.getElementById('drawer-holdings-list');

    if (dCur) dCur.innerText = formatINR(totalCur);
    if (dPnl) {
      const sign = totalPnl >= 0 ? '+' : '';
      dPnl.innerText = sign + formatINR(totalPnl);
      dPnl.className = 'font-data-mono font-bold text-base tabular-nums ' + (totalPnl >= 0 ? 'text-secondary' : 'text-error');
    }

    if (dList) {
      if (holdings.length === 0) {
        dList.innerHTML = '<div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">No long-term holdings found.</div>';
      } else {
        dList.innerHTML = holdings.map(h => {
          const sym = h.trading_symbol || h.company_name || 'HOLDING';
          const pnl = Number(h.pnl || 0);
          const isPos = pnl >= 0;
          return \`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 shadow-sm flex flex-col gap-1.5">
              <div class="flex justify-between items-center">
                <span class="font-data-mono font-bold text-xs text-primary">\${sym}</span>
                <span class="font-data-mono font-bold text-xs tabular-nums \${isPos ? 'text-secondary' : 'text-error'}">\${isPos ? '+' : ''}\${formatINR(pnl)}</span>
              </div>
              <div class="flex justify-between text-[11px] text-outline font-data-mono">
                <span>Qty: \${h.quantity} &bull; Avg: ₹\${Number(h.average_price || 0).toFixed(2)}</span>
                <span>LTP: ₹\${Number(h.last_price || h.ltp || 0).toFixed(2)}</span>
              </div>
            </div>
          \`;
        }).join('');
      }
    }
  }

  // Render Orders
  function renderOrdersMetrics(orders) {
    const dCount = document.getElementById('dorders-count');
    const dList = document.getElementById('drawer-orders-list');
    if (dCount) dCount.innerText = orders.length + ' orders';

    if (dList) {
      if (orders.length === 0) {
        dList.innerHTML = '<div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">No orders placed today.</div>';
      } else {
        dList.innerHTML = orders.map(o => {
          const isComplete = (o.status || '').toUpperCase() === 'complete';
          const isRejected = (o.status || '').toUpperCase() === 'rejected';
          const badgeClass = isComplete ? 'bg-secondary/15 text-secondary' : isRejected ? 'bg-error/15 text-error' : 'bg-surface-container text-outline';
          return \`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 shadow-sm flex flex-col gap-1">
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-2">
                  <span class="font-data-mono font-bold text-xs text-primary">\${o.trading_symbol || 'ORDER'}</span>
                  <span class="text-[10px] font-bold px-1.5 py-0.2 rounded \${o.transaction_type === 'BUY' ? 'bg-secondary/10 text-secondary' : 'bg-error/10 text-error'}">\${o.transaction_type || 'BUY'}</span>
                </div>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded font-label-caps uppercase \${badgeClass}">\${o.status || 'OPEN'}</span>
              </div>
              <div class="flex justify-between text-[11px] text-outline font-data-mono pt-1">
                <span>Qty: \${o.quantity || 0} @ ₹\${Number(o.price || 0).toFixed(2)}</span>
                <span>\${o.order_timestamp ? o.order_timestamp.split('T')[1]?.substring(0, 8) : ''}</span>
              </div>
              \${o.status_message ? \`<div class="text-[10px] text-error font-sans italic">\${o.status_message}</div>\` : ''}
            </div>
          \`;
        }).join('');
      }
    }
  }

  // Render Screener History
  function renderHistoryMetrics(history) {
    const dCount = document.getElementById('dhistory-count');
    const dList = document.getElementById('drawer-history-list');
    if (dCount) dCount.innerText = history.length + ' setups';

    if (dList) {
      if (history.length === 0) {
        dList.innerHTML = '<div class="p-6 text-center text-outline text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">No past screened setups found.</div>';
      } else {
        dList.innerHTML = history.slice(0, 15).map(item => {
          const sym = item.tradingsymbol || 'STOCK';
          return \`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 shadow-sm flex flex-col gap-1.5 hover:bg-surface-container-low transition-colors cursor-pointer" onclick="openTradingViewModal('\${sym}')">
              <div class="flex justify-between items-center">
                <span class="font-data-mono font-bold text-xs text-primary">\${sym}</span>
                \${getConvictionBadge(item.conviction)}
              </div>
              <div class="flex justify-between text-[11px] text-outline font-data-mono">
                <span>LTP: ₹\${Number(item.current_price || 0).toFixed(2)}</span>
                <span>VWAP: \${Number(item.distance_from_vwap_pct || 0).toFixed(2)}%</span>
                <span>RSI: \${Number(item.rsi_14 || 50).toFixed(1)}</span>
              </div>
            </div>
          \`;
        }).join('');
      }
    }
  }

  // Render MTF Radar Highlights
  function renderRadarHighlights() {
    const container = document.getElementById('radar-cards-container');
    const statConviction = document.getElementById('radar-stat-conviction');
    const tickerConviction = document.getElementById('ticker-conviction-count');
    if (!container) return;

    const highStocks = globalStocks.filter(s => (s.conviction || '').toUpperCase() === 'HIGH');
    if (statConviction) statConviction.innerText = highStocks.length + ' High Conviction';
    if (tickerConviction) tickerConviction.innerText = highStocks.length + ' HIGH CONVICTION';

    const displaySetups = highStocks.length > 0 ? highStocks.slice(0, 6) : globalStocks.slice(0, 6);

    if (displaySetups.length === 0) {
      container.innerHTML = \`
        <div onclick="openTradingViewModal('RELIANCE')" class="min-w-[270px] bg-surface border border-outline-variant rounded-xl p-sm hover-lift flex flex-col gap-1.5 cursor-pointer shadow-soft">
          <div class="flex justify-between items-center">
            <span class="font-data-mono text-data-mono font-bold text-primary">RELIANCE</span>
            <span class="bg-secondary/15 text-secondary font-label-caps text-[10px] font-bold px-2 py-0.5 rounded uppercase">HIGH</span>
          </div>
          <span class="text-xs text-on-surface-variant">Bullish MTF breakout above VWAP.</span>
          <div class="flex justify-between items-center text-[11px] font-data-mono text-outline pt-1 border-t border-outline-variant/20">
            <span>RSI: 58.4</span>
            <span class="text-secondary font-bold">+2.45% VWAP</span>
          </div>
        </div>
        <div onclick="openTradingViewModal('TCS')" class="min-w-[270px] bg-surface border border-outline-variant rounded-xl p-sm hover-lift flex flex-col gap-1.5 cursor-pointer shadow-soft">
          <div class="flex justify-between items-center">
            <span class="font-data-mono text-data-mono font-bold text-primary">TCS</span>
            <span class="bg-secondary/15 text-secondary font-label-caps text-[10px] font-bold px-2 py-0.5 rounded uppercase">BULLISH</span>
          </div>
          <span class="text-xs text-on-surface-variant">MACD momentum confirmation on D1.</span>
          <div class="flex justify-between items-center text-[11px] font-data-mono text-outline pt-1 border-t border-outline-variant/20">
            <span>RSI: 62.1</span>
            <span class="text-secondary font-bold">+1.80% VWAP</span>
          </div>
        </div>
      \`;
      return;
    }

    container.innerHTML = displaySetups.map(s => {
      const sym = s.tradingsymbol || 'STOCK';
      const isBull = Number(s.macd_value || 0) >= 0;
      return \`
        <div onclick="openTradingViewModal('\${sym}')" class="min-w-[270px] bg-surface border border-outline-variant rounded-xl p-sm hover-lift flex flex-col gap-1.5 cursor-pointer shadow-soft group">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-1.5">
              <span class="font-data-mono text-data-mono font-bold text-primary">\${sym}</span>
              <button onclick="copyToClipboard('\${sym}', event)" title="Copy for Upstox" class="opacity-0 group-hover:opacity-100 text-outline hover:text-primary transition-opacity">
                <span class="material-symbols-outlined text-[15px]">content_copy</span>
              </button>
            </div>
            \${getConvictionBadge(s.conviction)}
          </div>
          <div class="flex items-center justify-between text-xs text-on-surface-variant">
            <span>Sector: \${s.sector || 'GENERAL'}</span>
            <span class="font-data-mono font-bold text-primary tabular-nums">₹\${Number(s.current_price || 0).toFixed(2)}</span>
          </div>
          <div class="flex justify-between items-center text-[11px] font-data-mono text-outline pt-1.5 border-t border-outline-variant/20">
            <span>MACD: \${Number(s.macd_value || 0).toFixed(2)}</span>
            \${getVwapDevBadge(s.distance_from_vwap_pct)}
          </div>
        </div>
      \`;
    }).join('');
  }

  function formatISTDatetime(dateStr) {
    if (!dateStr) return 'Recent';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Recent';
      const dateFormatted = d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short'
      });
      const timeFormatted = d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return dateFormatted + ', ' + timeFormatted;
    } catch (e) {
      return 'Recent';
    }
  }

  // Render Main Table
  function renderMainTable() {
    const tbody = document.getElementById('main-table-body');
    const headerRow = document.getElementById('main-table-header-row');
    const countBadge = document.getElementById('table-screener-count');
    if (!tbody || !headerRow) return;

    const searchVal = (document.getElementById('ticker-search-input')?.value || '').toUpperCase();

    if (activeMainTab === 'screener') {
      headerRow.innerHTML = \`
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase bg-surface-container-lowest">Updated (IST)</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase bg-surface-container-lowest">Symbol / Sector</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">LTP (₹)</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">VWAP Dev %</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">MACD Momentum</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">RSI / Trend Sparkline</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Conviction</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Quick Actions</th>
      \`;

      const filtered = globalStocks.filter(s => {
        if (!searchVal) return true;
        return (s.tradingsymbol || '').toUpperCase().includes(searchVal) || (s.sector || '').toUpperCase().includes(searchVal);
      });

      if (countBadge) countBadge.innerText = filtered.length;

      if (filtered.length === 0) {
        tbody.innerHTML = \`
          <tr>
            <td colspan="8" class="p-8 text-center text-outline">
              <div class="flex flex-col items-center justify-center gap-2">
                <span class="material-symbols-outlined text-[32px] text-outline">filter_list_off</span>
                <span class="font-sans text-xs uppercase font-bold">No MTF screened setups match your search.</span>
                <a href="/mtf-screener" class="text-xs text-secondary font-bold hover:underline">Trigger On-Demand Scan &rarr;</a>
              </div>
            </td>
          </tr>
        \`;
        return;
      }

      tbody.innerHTML = filtered.map(s => {
        const sym = s.tradingsymbol || 'STOCK';
        const isBull = Number(s.macd_value || 0) >= 0;
        const updatedTimeStr = formatISTDatetime(s.updated_at || s.created_at);
        return \`
          <tr onclick="openTradingViewModal('\${sym}')" class="table-row-hover border-b border-outline-variant/30 cursor-pointer">
            <td class="p-sm text-xs font-data-mono text-outline font-bold whitespace-nowrap">
              \${updatedTimeStr}
            </td>
            <td class="p-sm font-data-mono">
              <div class="flex items-center gap-2">
                <div>
                  <div class="font-bold text-primary text-sm flex items-center gap-1.5">
                    \${sym}
                    <button onclick="copyToClipboard('\${sym}', event)" title="One-Click Copy for Upstox" class="hover-action-btn text-outline hover:text-primary">
                      <span class="material-symbols-outlined text-[16px]">content_copy</span>
                    </button>
                  </div>
                  <div class="text-[11px] text-outline font-sans">\${s.sector || 'GENERAL'}</div>
                </div>
              </div>
            </td>
            <td class="p-sm text-right font-bold text-primary tabular-nums">₹\${Number(s.current_price || 0).toFixed(2)}</td>
            <td class="p-sm text-right tabular-nums">\${getVwapDevBadge(s.distance_from_vwap_pct)}</td>
            <td class="p-sm text-right tabular-nums">\${getMacdBadge(s.macd_value)}</td>
            <td class="p-sm text-center tabular-nums">\${generateTrendSparkline(s.rsi_14, s.macd_value, isBull)}</td>
            <td class="p-sm text-center">\${getConvictionBadge(s.conviction)}</td>
            <td class="p-sm text-center" onclick="event.stopPropagation()">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="copyToClipboard('\${sym}', event)" title="Copy Symbol" class="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-primary transition-colors">
                  <span class="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
                <button onclick="openTradingViewModal('\${sym}')" title="Open TradingView Chart Modal" class="p-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors">
                  <span class="material-symbols-outlined text-[16px]">show_chart</span>
                </button>
              </div>
            </td>
          </tr>
        \`;
      }).join('');

    } else if (activeMainTab === 'positions') {
      headerRow.innerHTML = \`
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase bg-surface-container-lowest">Symbol</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Product</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">Qty</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">Avg Price (₹)</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">LTP (₹)</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">Unrealized P&L</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Actions</th>
      \`;

      if (globalPositions.length === 0) {
        tbody.innerHTML = \`
          <tr>
            <td colspan="7" class="p-8 text-center text-outline">
              <span class="font-sans text-xs uppercase font-bold">No active broker positions open.</span>
            </td>
          </tr>
        \`;
        return;
      }

      tbody.innerHTML = globalPositions.map(p => {
        const sym = p.trading_symbol || p.symbol || 'SYMBOL';
        const pnl = Number(p.pnl || p.m2m || 0);
        const isPos = pnl >= 0;
        return \`
          <tr onclick="openTradingViewModal('\${sym}')" class="table-row-hover border-b border-outline-variant/30 cursor-pointer">
            <td class="p-sm font-data-mono font-bold text-primary">
              <div class="flex items-center gap-1.5">
                \${sym}
                <button onclick="copyToClipboard('\${sym}', event)" title="Copy Symbol" class="hover-action-btn text-outline hover:text-primary">
                  <span class="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
              </div>
            </td>
            <td class="p-sm text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-surface-container font-label-caps uppercase">\${p.product || 'MTF'}</span></td>
            <td class="p-sm text-right tabular-nums">\${p.quantity || 0}</td>
            <td class="p-sm text-right tabular-nums">₹\${Number(p.buy_price || p.average_price || 0).toFixed(2)}</td>
            <td class="p-sm text-right tabular-nums font-bold">₹\${Number(p.last_price || p.ltp || 0).toFixed(2)}</td>
            <td class="p-sm text-right tabular-nums font-bold \${isPos ? 'text-secondary' : 'text-error'}">\${isPos ? '+' : ''}\${formatINR(pnl)}</td>
            <td class="p-sm text-center" onclick="event.stopPropagation()">
              <button onclick="openTradingViewModal('\${sym}')" title="Chart Modal" class="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors">
                <span class="material-symbols-outlined text-[16px]">show_chart</span>
              </button>
            </td>
          </tr>
        \`;
      }).join('');

    } else if (activeMainTab === 'history') {
      headerRow.innerHTML = \`
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase bg-surface-container-lowest">Symbol / Sector</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">Screened Price (₹)</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">VWAP Dev %</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right bg-surface-container-lowest">MACD Momentum</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Conviction</th>
        <th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center bg-surface-container-lowest">Timestamp</th>
      \`;

      if (globalHistory.length === 0) {
        tbody.innerHTML = \`
          <tr>
            <td colspan="6" class="p-8 text-center text-outline">
              <span class="font-sans text-xs uppercase font-bold">No historical screened setups recorded yet.</span>
            </td>
          </tr>
        \`;
        return;
      }

      tbody.innerHTML = globalHistory.map(h => {
        const sym = h.tradingsymbol || 'STOCK';
        return \`
          <tr onclick="openTradingViewModal('\${sym}')" class="table-row-hover border-b border-outline-variant/30 cursor-pointer">
            <td class="p-sm font-data-mono font-bold text-primary">
              <div class="flex items-center gap-1.5">
                \${sym}
                <button onclick="copyToClipboard('\${sym}', event)" title="Copy Symbol" class="hover-action-btn text-outline hover:text-primary">
                  <span class="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
              </div>
            </td>
            <td class="p-sm text-right tabular-nums font-bold">₹\${Number(h.current_price || 0).toFixed(2)}</td>
            <td class="p-sm text-right tabular-nums">\${getVwapDevBadge(h.distance_from_vwap_pct)}</td>
            <td class="p-sm text-right tabular-nums">\${getMacdBadge(h.macd_value)}</td>
            <td class="p-sm text-center">\${getConvictionBadge(h.conviction)}</td>
            <td class="p-sm text-center text-xs text-outline font-data-mono">\${h.updated_at ? new Date(h.updated_at).toLocaleDateString() + ' ' + new Date(h.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Recent'}</td>
          </tr>
        \`;
      }).join('');
    }
  }

  function filterRadarAndTable() {
    renderMainTable();
  }
  window.filterRadarAndTable = filterRadarAndTable;

  // Keyboard Shortcuts (Escape closes modals)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTradingViewModal();
      closeAccountDrawer();
    }
  });

  // Initial Load
  document.addEventListener('DOMContentLoaded', () => {
    applySidebarState();
    fetchAllDashboardData();

    // 10-Second Live M2M & Portfolio Polling Loop
    setInterval(() => {
      fetchAllDashboardData(false);
    }, 10000);
  });
</script>

</body></html>`;

	return c.html(html);
});

export default dashboard;
