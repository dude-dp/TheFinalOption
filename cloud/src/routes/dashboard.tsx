// ============================================
// Dashboard — Hono JSX Server-Rendered Template
// Premium dark-mode trading console
// ============================================

import { Hono } from 'hono';
import type { Env } from '../lib/types';
// Types imported from parent lib directory

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TheFinalOption — NIFTY Options Trading Console</title>
  <meta name="description" content="Automated NIFTY Index Options trading bot dashboard with real-time MACD analysis">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="dashboard-container">
    <!-- Header -->
    <header class="header-bar">
      <div>
        <h1 style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--accent-blue)">⚡</span> TheFinalOption
        </h1>
        <div style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">Hybrid Algorithmic Trading Terminal</div>
      </div>
      
      <div style="display: flex; gap: 16px; align-items: center;">
        <div class="metric-box" style="padding: 8px 16px; flex-direction: row; align-items: center;">
          <span class="metric-label">Capital:</span>
          <span id="margin-value" class="metric-value" style="font-size: 1rem;">₹---</span>
        </div>
        <div id="status-badge" class="metric-box" style="padding: 8px 16px; flex-direction: row; align-items: center;">
          <span id="status-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--text-muted);"></span>
          <span id="status-text" style="font-size: 0.85rem; font-weight: 600;">LOADING</span>
        </div>
      </div>
    </header>

    <!-- BENTO GRID -->
    <main class="bento-grid">
      
      <!-- Col 1: System Controls (Spans 4 of 12 columns) -->
      <section class="bento-card col-span-4">
        <h2 class="bento-card-title">⚙️ Operations Control</h2>
        <div class="control-group">
          <button id="toggle-bot-btn" class="btn">▶ Start Autonomous Trading</button>
          <button id="emergency-btn" class="btn emergency">🚨 EMERGENCY SQUARE-OFF</button>
          <hr style="border: 0; border-top: 1px solid var(--border); width: 100%; margin: 8px 0;" />
          <a href="/api/auth/login" class="btn">🔑 Refresh Upstox Token</a>
        </div>
      </section>

      <!-- Col 2: Active Position (Spans 8 of 12 columns) -->
      <section class="bento-card col-span-8">
        <h2 class="bento-card-title">🎯 Active Position Tracker</h2>
        <div id="no-position" style="color: var(--text-muted); display: flex; height: 100%; align-items: center; justify-content: center;">
          Searching for MACD Crossovers...
        </div>
        <div id="active-position" class="metrics-grid" style="display: none;">
          <div class="metric-box">
            <span class="metric-label">Contract</span>
            <span id="pos-symbol" class="metric-value">--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Entry Price</span>
            <span id="pos-entry" class="metric-value">₹--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Current LTP</span>
            <span id="pos-ltp" class="metric-value">₹--</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Unrealized PnL</span>
            <span id="pos-pnl" class="metric-value">₹--</span>
          </div>
        </div>
      </section>

      <!-- Col 3: Canvas Chart (Spans full width - 12 columns) -->
      <section class="bento-card col-span-12">
        <h2 class="bento-card-title">📈 NIFTY Spot & MACD Zero-Line</h2>
        <div style="width: 100%; height: 350px; position: relative;">
          <canvas id="trading-chart"></canvas>
        </div>
      </section>

      <!-- Col 4: Trade Ledger (Spans 6 columns) -->
      <section class="bento-card col-span-6">
        <h2 class="bento-card-title">📔 Order Ledger</h2>
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
            <tbody id="ledger-body">
              <!-- Populated by JS -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- Col 5: System Telemetry (Spans 6 columns) -->
      <section class="bento-card col-span-6">
        <h2 class="bento-card-title">💻 Execution Logs</h2>
        <div id="system-logs" class="log-console">
          <!-- Populated by JS -->
        </div>
      </section>

    </main>
  </div>
  
  <script src="/chart.js"></script>
  <script src="/dashboard.js"></script>
</body>
</html>`;

  return c.html(html);
});

export default dashboard;
