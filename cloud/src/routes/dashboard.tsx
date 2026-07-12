// ============================================
// Dashboard — Hono JSX Server-Rendered Template
// Premium dark-mode trading console — PWA Edition
// ============================================

import { Hono } from 'hono';
import type { Env } from '../lib/types';

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TheFinalOption Terminal</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
  <div class="dashboard-wrapper">
    
    <!-- Top Navigation -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-icon">T</div>
        TheFinalOption<span style="color: var(--text-secondary); font-weight: 400;">/</span>Terminal
      </div>
      <div class="controls">
        <button id="toggle-bot-btn" class="btn btn-outline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Start Bot
        </button>
        <button id="emergency-btn" class="btn btn-danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          Panic Sell All
        </button>
      </div>
    </header>

    <!-- Bento Grid Content -->
    <main class="bento-grid">
      
      <!-- Chart -->
      <section class="bento-item chart-section">
        <div class="chart-header-overlay">
          <h2 class="bento-title">Market Data</h2>
        </div>
        <div id="tv-chart-container" style="width: 100%; height: 100%;"></div>
      </section>

      <!-- Position Metrics -->
      <section class="bento-item position-section">
        <div class="bento-header">
          <h2 class="bento-title">Active Position</h2>
          <span class="mono" style="font-size: 12px; color: var(--text-secondary); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">LIVE</span>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Primary Metric -->
          <div class="metric-card" style="background: var(--accent-success-bg); border-color: rgba(16, 185, 129, 0.2);">
            <span class="metric-label text-green">Total PnL</span>
            <span id="pos-pnl" class="metric-value text-green">₹0.00</span>
          </div>
          
          <!-- Secondary Metrics -->
          <div style="display: flex; gap: 12px;">
              <div class="metric-card" style="flex: 1;">
                <span class="metric-label">Quantity</span>
                <span id="pos-qty" class="metric-value" style="font-size: 1.25rem;">0</span>
              </div>
              <div class="metric-card" style="flex: 1;">
                <span class="metric-label">Avg Price</span>
                <span id="pos-avg" class="metric-value" style="font-size: 1.25rem;">₹0.00</span>
              </div>
          </div>
        </div>
      </section>

      <!-- Terminal Logs -->
      <section class="bento-item logs-section">
        <div class="bento-header">
          <h2 class="bento-title">System Execution Logs</h2>
        </div>
        <div id="system-logs" class="terminal">
          <!-- Initial Boot Log -->
          <div class="log-line">
            <span class="log-time">[BOOT]</span>
            <span class="log-msg" style="color: var(--text-secondary);">Terminal session initialized...</span>
          </div>
        </div>
      </section>

      <!-- Ledger -->
      <section class="bento-item ledger-section">
        <div class="bento-header">
          <h2 class="bento-title">Order Ledger</h2>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Ticker</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="ledger-body">
              <tr>
                 <td colspan="6" style="text-align: center; color: var(--text-secondary);">Waiting for orders...</td>
              </tr>
            </tbody>
          </table>
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
