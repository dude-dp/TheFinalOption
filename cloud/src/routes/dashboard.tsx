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
  <!-- Toast Container -->
  <div id="toast-container" style="position: fixed; top: 20px; right: 20px; z-index: 9999;"></div>

  <div class="dashboard-wrapper">
    
    <!-- Top Navigation -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-icon">T</div>
        TheFinalOption<span style="color: var(--text-secondary); font-weight: 400;">/</span>Terminal
      </div>
      <div class="controls" style="display: flex; align-items: center; gap: 8px;">
        <a href="/api/auth/login" class="btn btn-outline" title="Refresh Token">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
        </a>
        <button id="manual-ce-btn" class="btn btn-outline" style="color: var(--accent-success); border-color: rgba(16, 185, 129, 0.2);" title="Force Buy CE">
          BUY CE
        </button>
        <button id="manual-pe-btn" class="btn btn-outline" style="color: var(--accent-danger); border-color: rgba(239, 68, 68, 0.2);" title="Force Buy PE">
          BUY PE
        </button>
        <button id="toggle-bot-btn" class="btn btn-outline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z"/></svg>
          <span style="margin-left: 4px;">Start Bot</span>
        </button>
        <button id="emergency-btn" class="btn btn-danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>
          <span style="margin-left: 4px;">EMERGENCY SQUARE-OFF</span>
        </button>
        <div class="metric-card" style="padding: 4px 10px; flex-direction: row; align-items: center; margin: 0; background: transparent; border: 1px solid var(--border-color); gap: 4px;">
          <span class="metric-label" style="font-size: 10px; margin: 0;">MARG</span>
          <span id="margin-value" class="mono" style="font-size: 12px; font-weight: 600;">---</span>
        </div>
        <div class="metric-card" style="padding: 4px 10px; flex-direction: row; align-items: center; margin: 0; background: transparent; border: 1px solid var(--border-color); gap: 6px;">
          <span class="metric-label" style="font-size: 10px; margin: 0;">API FUEL</span>
          <div style="width: 50px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 99px; overflow: hidden; display: flex;">
            <div id="api-fuel-fill" style="height: 100%; width: 0%; background: var(--text-muted); transition: width 0.3s, background-color 0.3s;"></div>
          </div>
          <span id="api-fuel-text" class="mono" style="font-size: 11px; font-weight: 600; min-width: 45px; text-align: right;">0/200</span>
        </div>
        <div id="status-badge" style="display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; background: rgba(255,255,255,0.05); margin-left: 4px;">
          <span id="status-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary);"></span>
          <span id="status-text" class="mono" style="font-size: 12px; font-weight: 600;">STOPPED</span>
        </div>
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
