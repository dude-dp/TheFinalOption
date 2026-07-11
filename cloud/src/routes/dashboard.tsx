// ============================================
// Dashboard — Hono JSX Server-Rendered Template
// Premium dark-mode trading console — PWA Edition
// ============================================

import { Hono } from 'hono';
import type { Env } from '../lib/types';

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>TheFinalOption — NIFTY Options Trading Console</title>
  <meta name="description" content="Automated NIFTY Index Options trading bot dashboard with real-time MACD analysis">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23E50914'%3E%3Cpath d='M0 0h24v24H0z' fill='none'/%3E%3Cpath d='M10 2c0-.88 1.056-1.331 1.692-.722 1.958 1.876 3.096 5.995 1.75 9.12l-.08.174.012.003c.625.133 1.203-.43 2.303-2.173l.14-.224a1 1 0 0 1 1.582-.153C18.733 9.46 20 12.402 20 14.295 20 18.56 16.409 22 12 22s-8-3.44-8-7.706c0-2.252 1.022-4.716 2.632-6.301l.605-.589c.241-.236.434-.43.618-.624C9.285 5.268 10 3.856 10 2'/%3E%3C/svg%3E">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <!-- Toast Container (globally positioned) -->
  <div id="toast-container"></div>

  <!-- Fullscreen Chart Overlay -->
  <div id="chart-overlay">
    <button id="close-fullscreen" style="display:flex;align-items:center;gap:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg> Exit Fullscreen</button>
    <canvas id="trading-chart-fs"></canvas>
  </div>

  <div class="dashboard-container">
    <!-- Header -->
    <header class="header-bar">
      <div>
        <h1 style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#E50914" class="icon icon-tabler icons-tabler-filled icon-tabler-flame">
            <path d="M0 0h24v24H0z" fill="none"/><path d="M10 2c0-.88 1.056-1.331 1.692-.722 1.958 1.876 3.096 5.995 1.75 9.12l-.08.174.012.003c.625.133 1.203-.43 2.303-2.173l.14-.224a1 1 0 0 1 1.582-.153C18.733 9.46 20 12.402 20 14.295 20 18.56 16.409 22 12 22s-8-3.44-8-7.706c0-2.252 1.022-4.716 2.632-6.301l.605-.589c.241-.236.434-.43.618-.624C9.285 5.268 10 3.856 10 2"/>
          </svg>
          TheFinalOption
        </h1>
        <div style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">Hybrid Algorithmic Terminal</div>
      </div>
      
      <div class="header-actions">
        <button id="settings-btn" class="icon-btn tooltip-trigger" style="color: var(--text-muted);" data-tooltip="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" /><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></svg>
        </button>

        <div class="header-divider"></div>

        <button id="manual-ce-btn" class="icon-btn tooltip-trigger" style="color: var(--accent-buy); border-color: rgba(16, 185, 129, 0.2);" data-tooltip="Force Buy CE (Call)">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 17l6 -6l4 4l8 -8" /><path d="M14 7l7 0l0 7" /></svg>
        </button>
        <button id="manual-pe-btn" class="icon-btn tooltip-trigger" style="color: var(--accent-sell); border-color: rgba(239, 68, 68, 0.2);" data-tooltip="Force Buy PE (Put)">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 7l6 6l4 -4l8 8" /><path d="M21 10l0 7l-7 0" /></svg>
        </button>

        <div class="header-divider"></div>

        <button id="toggle-bot-btn" class="icon-btn tooltip-trigger" style="color: var(--accent-blue);" data-tooltip="Start Autonomous Bot">
          <svg id="toggle-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>
        </button>
        <button id="emergency-btn" class="icon-btn emergency tooltip-trigger" style="color: var(--accent-sell);" data-tooltip="EMERGENCY SQUARE-OFF">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>
        </button>

        <div class="header-divider"></div>

        <a href="/api/auth/login" class="icon-btn tooltip-trigger" data-tooltip="Refresh Upstox Token">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
        </a>

        <div class="metric-box" style="padding: 6px 12px; flex-direction: row; align-items: center;">
          <span class="metric-label">₹</span>
          <span id="margin-value" class="metric-value" style="font-size: 1rem;">---</span>
        </div>
        <div id="status-badge" class="metric-box" style="padding: 6px 12px; flex-direction: row; align-items: center; border-radius: 99px;">
          <span id="status-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--text-muted); transition: background 0.3s, box-shadow 0.3s;"></span>
          <span id="status-text" style="font-weight: bold; font-size: 0.85rem; margin-left: 8px; letter-spacing: 0.5px;">STOPPED</span>
        </div>
      </div>
    </header>

    <!-- Dynamic Island: Sticky active position pill -->
    <div id="position-island">
      <div id="island-pill">
        <span id="island-dot" style="width:8px;height:8px;border-radius:50%;background:var(--accent-buy);display:inline-block;"></span>
        <span id="island-text">No Position</span>
      </div>
      <span style="color: var(--text-muted); font-size: 0.8rem;">▼ tap to expand</span>
    </div>
    <div id="island-expanded">
      <div class="metric-box" style="flex:1;min-width:100px;">
        <span class="metric-label">Contract</span>
        <span id="island-symbol" class="metric-value" style="font-size:1rem;">--</span>
      </div>
      <div class="metric-box" style="flex:1;min-width:100px;">
        <span class="metric-label">Entry</span>
        <span id="island-entry" class="metric-value" style="font-size:1rem;">₹--</span>
      </div>
      <div class="metric-box" style="flex:1;min-width:100px;">
        <span class="metric-label">Unrealized PnL</span>
        <span id="island-pnl" class="metric-value" style="font-size:1rem;">₹--</span>
      </div>
    </div>

    <!-- BENTO GRID -->
    <main class="bento-grid">

      <!-- Chart -->
      <section class="bento-card col-span-10" data-tab="chart" data-tab-label="Chart" style="padding:12px;">
        <div class="chart-header" style="margin-bottom:0;">
          <h2 class="bento-card-title" style="margin-bottom:0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 19l6 -6l4 4l6 -7"/><path d="M20 16v3h-3"/><path d="M4 5v14M4 19h16"/></svg>
            Nifty 50 Index · 1 · NSE
          </h2>
          <button id="fullscreen-btn" class="icon-btn" title="Fullscreen chart">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 8v-2a2 2 0 0 1 2 -2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2 -2v-2"/></svg>
          </button>
        </div>
        <div style="width: 100%; height: 520px; position: relative; border-radius: 12px; overflow: hidden;">
          <canvas id="trading-chart"></canvas>
        </div>
      </section>

      <!-- Active Position Tracker -->
      <section class="bento-card col-span-2" data-tab="controls" data-tab-label="Controls">
        <h2 class="bento-card-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M3 12h3m12 0h3M12 3v3m0 12v3"/></svg>
          Active Position
        </h2>
        <div id="no-position" style="padding: 8px 0; display: flex; flex-direction: column; gap: 16px; height: 100%; justify-content: center; align-items: center; text-align: center; color: var(--text-muted);">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.2;"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12l2 2l4 -4"/></svg>
          <p style="font-size: 0.9rem; margin: 0;">No active position.<br/>Waiting for signal.</p>
        </div>
        <div id="active-position" style="display: none; flex-direction: column; gap: 12px;">
          <div class="metric-box" id="pnl-card">
            <span class="metric-label">Unrealized PnL</span>
            <span id="pos-pnl" class="metric-value">₹--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Contract</span>
            <span id="pos-symbol" class="metric-value" style="font-size:1rem;">--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Entry Price</span>
            <span id="pos-entry" class="metric-value">₹--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Current LTP</span>
            <span id="pos-ltp" class="metric-value">₹--</span>
          </div>
        </div>
      </section>

      <!-- Order Ledger -->
      <section class="bento-card col-span-6" data-tab="ledger" data-tab-label="Ledger">
        <h2 class="bento-card-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-11a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1m3 0v18"/><path d="M13 8l2 0"/><path d="M13 12l2 0"/></svg>
          Order Ledger
        </h2>
        <div class="table-wrapper">
          <table id="ledger-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Contract</th>
                <th>Type</th>
                <th>Status</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody id="ledger-body"></tbody>
          </table>
        </div>
      </section>

      <!-- Execution Logs -->
      <section class="bento-card col-span-6" data-tab="logs" data-tab-label="Logs">
        <div class="log-header">
          <h2 class="bento-card-title" style="margin-bottom:0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 7l5 5l-5 5"/><path d="M12 19l7 0"/></svg>
            Execution Logs
            <span id="log-count-badge" class="log-count-badge">0</span>
          </h2>
          <div class="log-header-actions">
            <button id="log-autoscroll-btn" class="log-action-btn active" title="Auto-scroll">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M18 13l-6 6l-6 -6"/></svg>
            </button>
            <button id="log-clear-btn" class="log-action-btn" title="Clear display">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg>
            </button>
          </div>
        </div>
        <div class="log-toolbar">
          <div class="log-filters">
            <button class="log-chip active" data-filter="all">All</button>
            <button class="log-chip" data-filter="trade">
              <span class="log-chip-dot" style="background:var(--accent-buy)"></span> Trades
            </button>
            <button class="log-chip" data-filter="warn">
              <span class="log-chip-dot" style="background:#f59e0b"></span> Warnings
            </button>
            <button class="log-chip" data-filter="error">
              <span class="log-chip-dot" style="background:var(--accent-sell)"></span> Errors
            </button>
            <button class="log-chip" data-filter="system">
              <span class="log-chip-dot" style="background:var(--accent-blue)"></span> System
            </button>
          </div>
          <div class="log-search-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="log-search-icon"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35 -4.35"/></svg>
            <input type="text" id="log-search" class="log-search-input" placeholder="Search logs..." autocomplete="off" spellcheck="false" />
          </div>
        </div>
        <div id="system-logs" class="log-console"></div>
      </section>

    </main>
  </div>

  <!-- Mobile Bottom Navigation -->
  <nav class="mobile-nav">
    <button class="nav-tab active" data-tab="controls">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      Controls
    </button>
    <button class="nav-tab" data-tab="chart">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Chart
    </button>
    <button class="nav-tab" data-tab="ledger">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Ledger
    </button>
    <button class="nav-tab" data-tab="logs">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      Logs
    </button>
  </nav>

  <!-- Settings Modal -->
  <div class="settings-overlay" id="settings-modal" style="display: none;">
    <div class="settings-modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0;">Settings</h2>
        <button id="close-settings-btn" class="icon-btn"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg></button>
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; color: var(--text-muted); margin-bottom: 5px;">Max Risk %</label>
        <input type="number" id="setting-max-risk" class="settings-input" style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border); color: var(--text); padding: 8px; border-radius: var(--radius-sm);" min="1" max="100">
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; color: var(--text-muted); margin-bottom: 5px;">Max Slippage %</label>
        <input type="number" id="setting-max-slippage" class="settings-input" style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border); color: var(--text); padding: 8px; border-radius: var(--radius-sm);" min="0.1" max="5" step="0.1">
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: flex; align-items: center; gap: 10px; color: var(--text-muted); cursor: pointer;">
          <input type="checkbox" id="setting-paper-mode">
          Paper Trading Mode
        </label>
      </div>
      <div style="margin-bottom: 20px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
        <label style="display: block; color: var(--text-muted); margin-bottom: 5px;">Restore Configuration Failsafe</label>
        <div style="display: flex; gap: 8px;">
          <select id="setting-rollback-select" class="settings-input" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid var(--border); color: var(--text); padding: 8px; border-radius: var(--radius-sm); outline: none;">
            <option value="">Loading snapshots...</option>
          </select>
          <button id="rollback-btn" class="btn" style="background: var(--accent-sell); color: white; border: none; padding: 0 16px; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem;">Rollback</button>
        </div>
      </div>
      <button id="save-settings-btn" class="btn" style="width: 100%; background: var(--accent-blue); color: white; border: none; padding: 10px; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold;">Save Changes</button>
    </div>
  </div>

  <script src="/chart.js"></script>
  <script src="/dashboard.js"></script>
</body>
</html>`;

  return c.html(html);
});

export default dashboard;
