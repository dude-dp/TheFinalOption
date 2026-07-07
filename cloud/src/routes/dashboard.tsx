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
  <div class="app-container fade-in">

    <!-- Header -->
    <header class="dashboard-header" id="dashboard-header">
      <h1>⚡ TheFinalOption</h1>
      <div class="header-right">
        <span id="token-status" style="font-size:0.75rem;font-family:var(--font-mono)">⏳ Loading...</span>
        <div id="status-badge" class="status-badge stopped">
          <span id="status-dot" class="status-dot stopped"></span>
          <span id="status-text">LOADING</span>
        </div>
      </div>
    </header>

    <!-- Main Grid -->
    <div class="dashboard-grid">

      <!-- Control Matrix -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">🎛️ Control Matrix</span>
        </div>
        <div class="control-matrix">
          <button class="btn btn-start" id="btn-start">▶ Start Bot</button>
          <button class="btn btn-stop" id="btn-stop">⏹ Stop Bot</button>
          <button class="btn btn-emergency" id="btn-emergency">🚨 Emergency Square-Off</button>
          <button class="btn btn-auth" id="btn-auth">🔑 Re-Authenticate Upstox</button>
        </div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
          <div class="config-row">
            <label>Max Risk Per Trade</label>
            <input type="range" id="risk-slider" min="5" max="50" value="20" step="5">
            <span class="config-value" id="risk-value">20%</span>
          </div>
        </div>
      </div>

      <!-- Active Position -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📊 Active Position</span>
        </div>
        <div id="position-container">
          <p class="no-position">No active position</p>
        </div>
      </div>

      <!-- NIFTY + MACD Chart -->
      <div class="card full-width">
        <div class="card-header">
          <span class="card-title">📈 NIFTY Spot &amp; MACD Zero-Line</span>
        </div>
        <div class="chart-container">
          <canvas id="trading-chart"></canvas>
        </div>
      </div>

      <!-- Trade Log -->
      <div class="card full-width">
        <div class="card-header">
          <span class="card-title">📋 Trade Log</span>
        </div>
        <div style="overflow-x:auto">
          <table class="trade-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Action</th>
                <th>Lots (Qty)</th>
                <th>Price</th>
                <th>Status</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody id="orders-tbody">
              <tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px">Loading trade data...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- System Log Console -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">🖥️ System Log</span>
        </div>
        <div class="log-console" id="log-console">
          <div class="log-entry info">
            <span class="timestamp">--:--:--</span>
            <span class="level">[INFO]</span>
            <span class="message">Dashboard initialized. Waiting for data...</span>
          </div>
        </div>
      </div>

      <!-- Daily Summary -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">🤖 Daily AI Summary</span>
        </div>
        <div id="summary-container">
          <p class="no-position">Generated at market close (3:35 PM IST)</p>
        </div>
      </div>

    </div>
  </div>

  <script src="/chart.js"></script>
  <script src="/dashboard.js"></script>
</body>
</html>`;

  return c.html(html);
});

export default dashboard;
