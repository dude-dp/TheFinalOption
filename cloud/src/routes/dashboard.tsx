// ============================================
// Dashboard — Modern Hono Server-Rendered Template
// AlphaTrade Swing Trading Terminal
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
<title>AlphaTrade - Dashboard</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
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
                "DEFAULT": "0.125rem",
                "lg": "0.25rem",
                "xl": "0.5rem",
                "full": "0.75rem"
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
                        "Inter"
                ],
                "headline-md": [
                        "Inter"
                ],
                "display-lg": [
                        "Inter"
                ],
                "body-md": [
                        "Inter"
                ],
                "display-lg-mobile": [
                        "Inter"
                ],
                "data-mono": [
                        "JetBrains Mono"
                ],
                "body-sm": [
                        "Inter"
                ],
                "data-mono-lg": [
                        "JetBrains Mono"
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
                                "fontWeight": "500"
                        }
                ],
                "display-lg": [
                        "32px",
                        {
                                "lineHeight": "40px",
                                "letterSpacing": "-0.02em",
                                "fontWeight": "600"
                        }
                ],
                "body-md": [
                        "16px",
                        {
                                "lineHeight": "24px",
                                "fontWeight": "400"
                        }
                ],
                "display-lg-mobile": [
                        "24px",
                        {
                                "lineHeight": "32px",
                                "fontWeight": "600"
                        }
                ],
                "data-mono": [
                        "14px",
                        {
                                "lineHeight": "20px",
                                "letterSpacing": "-0.01em",
                                "fontWeight": "500"
                        }
                ],
                "body-sm": [
                        "14px",
                        {
                                "lineHeight": "20px",
                                "fontWeight": "400"
                        }
                ],
                "data-mono-lg": [
                        "18px",
                        {
                                "lineHeight": "24px",
                                "fontWeight": "600"
                        }
                ]
        },
        "boxShadow": {
            'soft': '0 4px 20px rgba(0, 0, 0, 0.04)',
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
        
        /* Subtle glow for positive P&L rows */
        .row-glow-positive:hover {
            box-shadow: inset 0 0 10px rgba(0, 108, 73, 0.05);
            background-color: rgba(0, 108, 73, 0.02);
        }

        /* Hover lift for cards */
        .hover-lift {
            transition: transform 300ms ease-in-out, box-shadow 300ms ease-in-out, border-color 300ms ease-in-out;
        }
        .hover-lift:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
            border-color: #c5c6ca;
        }

        /* Animations */
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translate3d(0, 20px, 0);
            }
            to {
                opacity: 1;
                transform: translate3d(0, 0, 0);
            }
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.6s ease-out forwards;
            opacity: 0;
        }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        .delay-300 { animation-delay: 300ms; }
        
        /* Hide scrollbar for horizontal lists */
        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
    </style>
</head>
<body class="bg-background text-on-background font-body-md text-body-md antialiased overflow-x-hidden relative min-h-screen flex">
<!-- Ambient Shader Background -->
<div class="fixed inset-0 z-[-1] pointer-events-none opacity-40">

</div>
<!-- SideNavBar (Desktop) -->
<nav class="bg-surface dark:bg-primary docked h-screen w-64 hidden md:flex flex-col border-r border-outline-variant fixed left-0 top-0 z-40 p-md gap-xs flat no shadows">
<div class="flex items-center gap-xs mb-lg px-2 flex-col items-start">
<span class="font-display-lg text-display-lg font-bold text-primary dark:text-primary-fixed">AlphaTrade</span>
<span class="font-label-caps text-label-caps text-on-surface-variant">Swing Trading Terminal</span>
</div>
<div class="flex flex-col gap-xs flex-1 font-body-md text-body-md font-label-caps text-label-caps">
<a class="text-primary dark:text-primary-fixed font-bold border-r-2 border-primary dark:border-primary-fixed rounded-lg flex items-center gap-sm px-4 py-3 active:scale-98 transition-transform hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 bg-surface-container-low" href="/">
<span class="material-symbols-outlined">dashboard</span>
<span class="uppercase">Dashboard</span>
</a>
<a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="/mtf-screener">
<span class="material-symbols-outlined">filter_list</span>
<span class="uppercase">MTF Screener</span>
</a>
<a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="#">
<span class="material-symbols-outlined">account_balance_wallet</span>
<span class="uppercase">Portfolio</span>
</a><a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="#">
<span class="material-symbols-outlined">payments</span>
<span class="uppercase">Funds</span>
</a>
<a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="#"><span class="material-symbols-outlined">show_chart</span>
<span class="uppercase">Live Positions</span></a>
</div>
<div class="mt-auto flex flex-col gap-xs font-body-md text-body-md font-label-caps text-label-caps">
<a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="#">
<span class="material-symbols-outlined">help</span>
<span class="uppercase">Support</span>
</a>
<a class="text-on-surface-variant dark:text-on-primary-container hover:bg-surface-container-low dark:hover:bg-primary-container transition-colors duration-300 rounded-lg flex items-center gap-sm px-4 py-3" href="#">
<span class="material-symbols-outlined">logout</span>
<span class="uppercase">Sign Out</span>
</a>
</div>
</nav>
<!-- Main Content Area -->
<div class="flex-1 md:ml-64 flex flex-col min-h-screen">
<!-- Top Sticky Header -->
<header class="sticky top-0 z-30 bg-surface/80 dark:bg-primary/80 backdrop-blur-md border-b border-outline-variant px-margin-mobile md:px-margin-desktop h-16 flex items-center justify-between flat">
<div class="flex items-center md:hidden">
<span class="font-display-lg text-display-lg font-black tracking-tight text-primary dark:text-primary-fixed">AlphaTrade</span>
</div>
<div class="hidden md:flex items-center flex-1 max-w-md mx-md">
<div class="relative w-full">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
<input class="w-full bg-surface-container pl-10 pr-4 py-2 rounded-lg border-outline-variant focus:border-primary focus:ring-0 text-body-sm font-body-sm placeholder:text-outline transition-colors" placeholder="Search tickers (e.g., RELIANCE)" type="text">
</div>
</div>
<div class="flex items-center gap-md">
<div class="hidden lg:flex flex-col items-end">
<span class="font-label-caps text-label-caps text-outline uppercase tracking-wider">Account Balance</span>
<div class="flex items-center gap-sm">
<span class="font-data-mono-lg text-data-mono-lg text-primary">₹12,45,000</span>
<span class="font-data-mono text-data-mono text-secondary bg-secondary/10 px-2 py-0.5 rounded flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]">arrow_upward</span>
                            ₹14,200 (1.1%)
                        </span>
</div>
</div>
<button class="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center hover:opacity-80 transition-opacity active:opacity-70">
<span class="material-symbols-outlined text-on-surface-variant">notifications</span>
</button>
<div class="w-8 h-8 rounded-full bg-surface-container overflow-hidden flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity active:opacity-70">
<span class="material-symbols-outlined text-on-surface-variant">person</span>
</div>
</div>
</header>
<!-- Main Dashboard Canvas -->
<main class="flex-1 p-margin-mobile md:p-margin-desktop overflow-y-auto pb-24 md:pb-margin-desktop">
<div class="grid grid-cols-1 lg:grid-cols-12 gap-md">
<!-- Left/Main Column (9 cols on Desktop) -->
<div class="lg:col-span-9 flex flex-col gap-md">
<!-- Top Overview Cards -->
<section class="grid grid-cols-1 md:grid-cols-3 gap-md animate-fade-in-up">
<div class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft">
<span class="font-label-caps text-label-caps text-outline uppercase tracking-wider mb-2">Total Equity</span>
<span class="font-data-mono-lg text-data-mono-lg text-primary text-[24px]">₹12,45,000.00</span>
</div>
<div class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft">
<span class="font-label-caps text-label-caps text-outline uppercase tracking-wider mb-2">Open Positions (8)</span>
<span class="font-data-mono-lg text-data-mono-lg text-primary text-[24px]">₹8,12,400.50</span>
</div>
<div class="bg-surface border border-outline-variant rounded-xl p-md hover-lift flex flex-col shadow-soft">
<span class="font-label-caps text-label-caps text-outline uppercase tracking-wider mb-2">MTF Buying Power</span>
<span class="font-data-mono-lg text-data-mono-lg text-primary text-[24px]">₹24,50,000.00</span>
</div>
</section>
<!-- Main Chart Area -->
<section class="bg-surface border border-outline-variant rounded-xl p-md hover-lift animate-fade-in-up delay-100 flex flex-col min-h-[300px] shadow-soft relative overflow-hidden">
<div class="absolute inset-0 z-0 opacity-30 pointer-events-none">

</div>
<div class="flex justify-between items-center mb-md relative z-10">
<h2 class="font-headline-md text-headline-md text-primary">Portfolio Growth (30D)</h2>
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">more_vert</button>
</div>
<div class="flex-1 w-full relative bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant/30 rounded-lg flex items-center justify-center text-outline z-10">
<!-- Placeholder for actual chart rendering -->
<span class="font-body-sm text-body-sm">[Chart Visualization Area]</span>
<!-- SVG decorative line to simulate chart -->
<svg class="absolute inset-0 w-full h-full opacity-40" preserveAspectRatio="none" viewBox="0 0 100 100">
<path d="M0 80 Q 20 70, 40 85 T 80 50 T 100 20 L 100 100 L 0 100 Z" fill="rgba(0, 108, 73, 0.05)"></path>
<path d="M0 80 Q 20 70, 40 85 T 80 50 T 100 20" fill="none" stroke="#006c49" stroke-width="0.5"></path>
</svg>
</div>
</section>
<!-- MTF Screener Highlights (Horizontal Scroll) -->
<section class="animate-fade-in-up delay-200">
<div class="flex justify-between items-center mb-sm">
  <h3 class="font-label-caps text-label-caps text-outline uppercase tracking-wider">High Probability MTF Setups</h3>
  <a href="/mtf-screener" class="text-xs font-semibold text-secondary hover:underline flex items-center gap-1">Open Screener &rarr;</a>
</div>
<div class="flex gap-sm overflow-x-auto no-scrollbar pb-xs">
<a href="/mtf-screener?symbol=RELIANCE" class="min-w-[280px] bg-surface border border-outline-variant rounded-lg p-sm hover-lift flex flex-col gap-xs cursor-pointer shadow-soft text-inherit no-underline">
<div class="flex justify-between items-center">
<span class="font-data-mono text-data-mono font-semibold">RELIANCE</span>
<span class="bg-secondary/10 text-secondary font-label-caps text-label-caps px-2 py-1 rounded">Bullish</span>
</div>
<span class="font-body-sm text-body-sm text-on-surface-variant">Bullish Engulfing on D1 at major support.</span>
</a>
<a href="/mtf-screener?symbol=INFY" class="min-w-[280px] bg-surface border border-outline-variant rounded-lg p-sm hover-lift flex flex-col gap-xs cursor-pointer shadow-soft text-inherit no-underline">
<div class="flex justify-between items-center">
<span class="font-data-mono text-data-mono font-semibold">INFY</span>
<span class="bg-secondary/10 text-secondary font-label-caps text-label-caps px-2 py-1 rounded">Setup</span>
</div>
<span class="font-body-sm text-body-sm text-on-surface-variant">Consolidating near 200 EMA. Breakout imminent.</span>
</a>
<a href="/mtf-screener?symbol=HDFCBANK" class="min-w-[280px] bg-surface border border-outline-variant rounded-lg p-sm hover-lift flex flex-col gap-xs cursor-pointer shadow-soft text-inherit no-underline">
<div class="flex justify-between items-center">
<span class="font-data-mono text-data-mono font-semibold">HDFCBANK</span>
<span class="bg-secondary/10 text-secondary font-label-caps text-label-caps px-2 py-1 rounded">Swing</span>
</div>
<span class="font-body-sm text-body-sm text-on-surface-variant">Volume spike on recent up-close.</span>
</a>
<a href="/mtf-screener?symbol=TCS" class="min-w-[280px] bg-surface border border-outline-variant rounded-lg p-sm hover-lift flex flex-col gap-xs cursor-pointer shadow-soft text-inherit no-underline">
<div class="flex justify-between items-center">
<span class="font-data-mono text-data-mono font-semibold">TCS</span>
<span class="bg-secondary/10 text-secondary font-label-caps text-label-caps px-2 py-1 rounded">Alert</span>
</div>
<span class="font-body-sm text-body-sm text-on-surface-variant">MACD Crossover on Weekly timeframe.</span>
</a>
</div>
</section>
<!-- Active Positions Table -->
<section class="bg-surface border border-outline-variant rounded-xl hover-lift animate-fade-in-up delay-300 overflow-hidden shadow-soft">
<div class="p-md border-b border-outline-variant flex justify-between items-center">
<h2 class="font-headline-md text-headline-md text-primary">Active Positions</h2>
<button class="bg-primary text-on-primary font-label-caps text-label-caps px-4 py-2 rounded uppercase tracking-wider hover:bg-primary/90 transition-colors">View All</button>
</div>
<div class="overflow-x-auto">
<table class="w-full text-left border-collapse">
<thead>
<tr class="border-b border-outline-variant/50 bg-surface-container-lowest">
<th class="p-sm font-label-caps text-label-caps text-outline uppercase">Symbol</th>
<th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right">Qty</th>
<th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right">Avg Price</th>
<th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right">CMP</th>
<th class="p-sm font-label-caps text-label-caps text-outline uppercase text-right">Unrealized P&amp;L</th>
<th class="p-sm font-label-caps text-label-caps text-outline uppercase text-center">Action</th>
</tr>
</thead>
<tbody class="font-data-mono text-data-mono">
<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors row-glow-positive">
<td class="p-sm font-data-mono text-data-mono font-semibold">TCS</td>
<td class="p-sm text-right">150</td>
<td class="p-sm text-right">3,850.00</td>
<td class="p-sm text-right">3,925.50</td>
<td class="p-sm text-right text-secondary">+11,325.00</td>
<td class="p-sm text-center"><button class="text-outline hover:text-primary"><span class="material-symbols-outlined text-[20px]">info</span></button></td>
</tr>
<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors row-glow-positive">
<td class="p-sm font-data-mono text-data-mono font-semibold">ICICIBANK</td>
<td class="p-sm text-right">400</td>
<td class="p-sm text-right">1,020.25</td>
<td class="p-sm text-right">1,045.00</td>
<td class="p-sm text-right text-secondary">+9,900.00</td>
<td class="p-sm text-center"><button class="text-outline hover:text-primary"><span class="material-symbols-outlined text-[20px]">info</span></button></td>
</tr>
<tr class="border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors">
<td class="p-sm font-data-mono text-data-mono font-semibold">WIPRO</td>
<td class="p-sm text-right">1000</td>
<td class="p-sm text-right">485.50</td>
<td class="p-sm text-right">482.00</td>
<td class="p-sm text-right text-error">-3,500.00</td>
<td class="p-sm text-center"><button class="text-outline hover:text-primary"><span class="material-symbols-outlined text-[20px]">info</span></button></td>
</tr>
</tbody>
</table>
</div>
</section>
</div>
<!-- Right Column (Watchlist - Desktop Only) -->
<div class="hidden lg:flex flex-col gap-md lg:col-span-3">
<section class="bg-surface border border-outline-variant rounded-xl p-md hover-lift animate-fade-in-up delay-100 flex flex-col gap-sm shadow-soft">
<h3 class="font-headline-md text-headline-md text-primary border-b border-outline-variant pb-sm mb-sm">Indices Watch</h3>
<div class="flex justify-between items-center py-2 border-b border-outline-variant/30">
<div>
<div class="font-body-sm text-body-sm font-semibold">NIFTY 50</div>
<div class="font-data-mono text-data-mono text-secondary text-[12px]">+0.45%</div>
</div>
<div class="font-data-mono text-data-mono">22,145.30</div>
</div>
<div class="flex justify-between items-center py-2 border-b border-outline-variant/30">
<div>
<div class="font-body-sm text-body-sm font-semibold">NIFTY BANK</div>
<div class="font-data-mono text-data-mono text-secondary text-[12px]">+0.82%</div>
</div>
<div class="font-data-mono text-data-mono">46,850.10</div>
</div>
<div class="flex justify-between items-center py-2">
<div>
<div class="font-body-sm text-body-sm font-semibold">INDIA VIX</div>
<div class="font-data-mono text-data-mono text-error text-[12px]">-2.10%</div>
</div>
<div class="font-data-mono text-data-mono">14.25</div>
</div>
</section>
</div>
</div>
</main>
</div>
<!-- BottomNavBar (Mobile Only) -->
<nav class="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-2 bg-surface dark:bg-primary z-50 shadow-sm border-t border-outline-variant dark:border-outline">
<a class="flex flex-col items-center justify-center bg-secondary-container dark:bg-secondary text-on-secondary-container dark:text-on-secondary rounded-xl p-2 active:scale-95 transition-all hover:bg-surface-container-high" href="/">
<span class="material-symbols-outlined">dashboard</span>
<span class="font-body-sm text-body-sm hidden">Dashboard</span>
</a>
<a class="flex flex-col items-center justify-center text-on-surface-variant dark:text-on-primary-container p-2 hover:bg-surface-container-high active:scale-95 transition-all" href="/mtf-screener">
<span class="material-symbols-outlined">filter_list</span>
</a>
<a class="flex flex-col items-center justify-center text-on-surface-variant dark:text-on-primary-container p-2 hover:bg-surface-container-high active:scale-95 transition-all" href="#">
<span class="material-symbols-outlined">account_balance_wallet</span>
</a>
<a class="flex flex-col items-center justify-center text-on-surface-variant dark:text-on-primary-container p-2 hover:bg-surface-container-high active:scale-95 transition-all" href="#">
<span class="material-symbols-outlined">receipt_long</span>
</a>
</nav>


</body></html>`;

  return c.html(html);
});

export default dashboard;
