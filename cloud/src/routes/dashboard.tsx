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
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>
</head>
<body>
  <!-- Toast Container -->
  <div id="toast-container" style="position: fixed; top: 20px; right: 20px; z-index: 9999;"></div>

  <!-- Top Navigation -->
  <header class="topbar">
    <div class="brand-container">
      <div class="brand">
        <div class="brand-icon">T</div>
        TheFinalOption<span style="color: var(--text-secondary); font-weight: 400;">/</span>Terminal
      </div>
      
      <div class="brand-metrics">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="letter-spacing: 0.05em; color: var(--text-secondary);">MARG</span>
          <span id="margin-value" style="font-weight: 600; color: var(--text-primary);">---</span>
        </div>
        <span style="color: var(--border-color);">|</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="letter-spacing: 0.05em; color: var(--text-secondary);">API FUEL</span>
          <div style="width: 50px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
            <div id="api-fuel-fill" style="width: 0%; height: 100%; background: var(--accent-success); transition: width 0.3s ease;"></div>
          </div>
          <span id="api-fuel-text" style="color: var(--text-primary);">0/200</span>
        </div>
        <span style="color: var(--border-color);">|</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span id="status-dot" style="width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); transition: background 0.3s ease;"></span>
          <span id="status-text" style="font-weight: 500; color: var(--text-primary);">STOPPED</span>
        </div>
      </div>
    </div>

    <div class="controls" style="display: flex; align-items: center; gap: 8px;">
      <a href="/api/auth/login" class="btn btn-outline" title="Refresh Token">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
      </a>
      <button id="toggle-bot-btn" class="btn btn-outline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z"/></svg>
        <span style="margin-left: 4px;">Start Bot</span>
      </button>
      <button id="emergency-btn" class="btn btn-danger">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>
        <span style="margin-left: 4px;">EMERGENCY SQUARE-OFF</span>
      </button>
      <button id="mode-toggle" class="btn btn-outline" style="display: flex; align-items: center; gap: 6px; padding: 4px 10px;" title="Toggle Trading Mode">
        <span id="mode-icon">🧪</span>
        <span id="mode-text" class="mono" style="font-size: 11px; font-weight: 600; text-transform: uppercase;">Mode: PAPER</span>
      </button>
      <button id="voice-toggle" class="btn btn-outline" style="display: flex; align-items: center; gap: 6px; padding: 4px 10px;" title="Toggle Voice Telemetry">
        <span id="voice-icon">🔇</span>
        <span id="voice-text" class="mono" style="font-size: 11px; font-weight: 600; text-transform: uppercase;">Voice: Off</span>
      </button>
    </div>
  </header>

  <div class="dashboard-wrapper">
    <!-- Quant Analytics Ratios Banner -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 0 auto 16px auto; width: 100%; max-width: 1600px; padding: 0 24px; box-sizing: border-box;">
      <div class="metric-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 16px;">
        <span class="metric-label" style="text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Sharpe Ratio</span>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span id="metric-sharpe" class="metric-value" style="font-size: 1.5rem; font-family: var(--font-mono);">0.00</span>
          <span id="badge-sharpe" style="font-size: 10px; font-family: var(--font-mono); padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); color: var(--text-secondary); font-weight: 700;">WAITING</span>
        </div>
      </div>

      <div class="metric-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 16px;">
        <span class="metric-label" style="text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Sortino Ratio</span>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span id="metric-sortino" class="metric-value" style="font-size: 1.5rem; font-family: var(--font-mono);">0.00</span>
          <span id="badge-sortino" style="font-size: 10px; font-family: var(--font-mono); padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); color: var(--text-secondary); font-weight: 700;">WAITING</span>
        </div>
      </div>

      <div class="metric-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 16px;">
        <span class="metric-label" style="text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Calmar Ratio</span>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span id="metric-calmar" class="metric-value" style="font-size: 1.5rem; font-family: var(--font-mono);">0.00</span>
          <span id="badge-calmar" style="font-size: 10px; font-family: var(--font-mono); padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); color: var(--text-secondary); font-weight: 700;">WAITING</span>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <!-- Bento Grid Content -->
    <main class="bento-grid">
      
      <!-- Chart -->
      <section class="bento-item chart-section">
        <div class="chart-header-overlay">
          <h2 class="bento-title">Market Data</h2>
          
          <div class="chart-actions">
            <button id="manual-ce-btn" class="btn btn-buy-ce">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 17l6 -6l4 4l8 -8" />
                <path d="M14 7l7 0l0 7" />
              </svg>
              Buy CE
            </button>
            
            <button id="manual-pe-btn" class="btn btn-buy-pe">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7l6 6l4 -4l8 8" />
                <path d="M21 10l0 7l-7 0" />
              </svg>
              Buy PE
            </button>
          </div>
        </div>
        <div id="tv-chart-container" style="width: 100%; flex: 1; min-height: 400px;"></div>
      </section>

      <!-- Position Metrics -->
      <section class="bento-item position-section">
        <div class="bento-header">
          <h2 class="bento-title">Active Position</h2>
          <span id="position-mode-badge" class="mono" style="font-size: 12px; color: var(--text-secondary); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">LIVE</span>
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

      <!-- Quant Analytics -->
      <section class="bento-item analytics-section">
        <div class="bento-header" style="margin-bottom: 16px;">
          <h2 class="bento-title">Quant Analytics</h2>
          <span class="mono" style="font-size: 12px; color: var(--accent-info); border: 1px solid rgba(59, 130, 246, 0.3); padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.1);">1m</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex-grow: 1; align-content: space-between;">
          <div class="metric-card" style="padding: 12px;">
            <span class="metric-label">PCR</span>
            <span id="metric-pcr" class="metric-value" style="font-size: 1.25rem;">--</span>
          </div>
          <div class="metric-card" style="padding: 12px;">
            <span class="metric-label">MACD Hist</span>
            <span id="metric-macd" class="metric-value text-green" style="font-size: 1.25rem;">--</span>
          </div>
          <div class="metric-card" style="padding: 12px;">
            <span class="metric-label">ATR (Vol)</span>
            <span id="metric-atr" class="metric-value" style="font-size: 1.25rem;">--</span>
          </div>
          <div class="metric-card" style="padding: 12px;">
            <span class="metric-label">ADX (Trend)</span>
            <span id="metric-adx" class="metric-value" style="font-size: 1.25rem;">--</span>
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
                <th>PnL</th>
              </tr>
            </thead>
            <tbody id="ledger-body">
              <tr>
                 <td colspan="7" style="text-align: center; color: var(--text-secondary);">Waiting for orders...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- System Drawdown -->
      <section class="bento-item drawdown-section">
        <div class="bento-header">
          <h2 class="bento-title">System Drawdown (Peak-to-Trough)</h2>
          <span class="mono" style="font-size: 12px; color: var(--accent-danger); border: 1px solid var(--accent-danger-bg); padding: 2px 6px; border-radius: 4px;">Psychology Anchor</span>
        </div>
        <div style="position: relative; flex: 1; min-height: 300px; width: 100%;">
          <canvas id="drawdownChart"></canvas>
        </div>
      </section>

      <!-- Monte Carlo Risk Simulator -->
      <section class="bento-item monte-carlo-section">
        <div class="bento-header">
          <h2 class="bento-title">Monte Carlo Risk Simulator (30 Trades)</h2>
          <span id="mc-expectancy-label" class="mono" style="font-size: 12px; color: var(--accent-blue); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">Calculating...</span>
        </div>
        <div style="position: relative; flex: 1; min-height: 300px; width: 100%;">
          <canvas id="monteCarloChart"></canvas>
        </div>
      </section>

      <!-- Time of Day Analytics -->
      <section class="bento-item time-of-day-section">
        <div class="bento-header">
          <h2 class="bento-title">Time of Day</h2>
        </div>
        <div style="position: relative; flex: 1; min-height: 300px; width: 100%;">
          <canvas id="timeOfDayChart"></canvas>
        </div>
      </section>

      <!-- Execution Slippage Heatmap -->
      <section class="bento-item slippage-section">
        <div class="bento-header">
          <h2 class="bento-title">Execution Slippage Heatmap</h2>
          <div id="slippage-gauge" class="mono" style="font-size: 12px; color: var(--text-secondary); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">Loading...</div>
        </div>
        <div style="position: relative; flex: 1; min-height: 250px; width: 100%;">
          <canvas id="slippageChart"></canvas>
        </div>
      </section>

    </main>
  </div>
  
  <!-- Journal Modal Overlay -->
  <div id="journal-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">Trade Journal Entry</h3>
        <button onclick="closeJournalModal()" class="modal-close">✕</button>
      </div>
      <p id="journal-trade-id" class="mono" style="font-size: 10px; color: var(--text-secondary);"></p>
      
      <div class="modal-body">
        <div class="modal-field">
          <label class="modal-label">Tags</label>
          <input type="text" id="journal-tags" class="modal-input" placeholder="e.g. #FOMO, #PerfectSetup, #ManualOverride" />
        </div>
        
        <div class="modal-field">
          <label class="modal-label">Execution Notes</label>
          <textarea id="journal-notes" rows="4" class="modal-textarea" placeholder="Why did you take this trade? Was it automated or manual?"></textarea>
        </div>
      </div>
      
      <div class="modal-footer">
        <button onclick="closeJournalModal()" class="btn btn-outline" style="padding: 10px 16px;">Cancel</button>
        <button id="save-journal-btn" onclick="saveTradeJournal()" class="btn" style="background: var(--accent-info); color: #fff; border-color: rgba(59, 130, 246, 0.2); padding: 10px 16px;">Save Journal</button>
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
