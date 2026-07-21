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
        <div style="display: flex; flex-direction: column; justify-content: center; min-width: 120px;">
          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; font-family: var(--font-mono);">
            <span style="letter-spacing: 0.05em; color: var(--text-secondary);">MARG</span>
            <span id="margin-value" style="font-weight: 600; color: var(--text-primary);">---</span>
          </div>
          <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
            <div id="margin-util-fill" style="width: 0%; height: 100%; background: var(--accent-success); transition: width 0.3s ease, background 0.3s ease;"></div>
          </div>
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
        <span style="color: var(--border-color);">|</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span id="health-ping-dot" style="width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); transition: background 0.3s ease;" title="WebSocket/API Latency"></span>
          <span id="session-timer" style="font-weight: 500; color: var(--text-primary); font-family: var(--font-mono); font-size: 0.8rem;">--:--:--</span>
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
    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin: 0 auto 16px auto; width: 100%; max-width: 1600px; padding: 0 24px; box-sizing: border-box;">
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

      <div class="metric-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 16px;">
        <span class="metric-label" style="text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Win Rate</span>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span id="metric-winrate" class="metric-value" style="font-size: 1.5rem; font-family: var(--font-mono);">0%</span>
        </div>
      </div>

      <div class="metric-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 16px;">
        <span class="metric-label" style="text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">Profit Factor</span>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span id="metric-profitfactor" class="metric-value" style="font-size: 1.5rem; font-family: var(--font-mono);">0.0</span>
        </div>
      </div>
    </div>

    <!-- Drawdown Alert Banner -->
    <div id="drawdown-alert" style="display: none; background: rgba(255, 59, 48, 0.1); border: 1px solid var(--accent-danger); color: var(--accent-danger); padding: 12px 24px; border-radius: 8px; margin: 0 auto 16px auto; max-width: 1600px; width: calc(100% - 48px); font-weight: 600; align-items: center; gap: 8px; box-sizing: border-box;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span><strong>DRAWDOWN ALERT:</strong> Max drawdown threshold exceeded. PnL has dropped <span id="dd-value">0%</span> from the daily peak.</span>
    </div>

    <!-- Main Content -->
    <!-- Bento Grid Content -->
    <main class="bento-grid">
      <section class="bento-item chart-section">
        <div class="chart-header-overlay">
          <h2 class="bento-title">Market Data</h2>
          <div class="chart-actions">
            <button id="manual-ce-btn" class="btn btn-buy-ce">Buy CE</button>
            <button id="manual-pe-btn" class="btn btn-buy-pe">Buy PE</button>
          </div>
        </div>
        <div id="tv-chart-container" style="width: 100%; height: 100%;"></div>
      </section>

      <!-- Position Metrics -->
      <section class="bento-item position-section">
        <div class="bento-header">
          <h2 class="bento-title">Active Position</h2>
          <span class="badge live">Synced</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div class="metric-card" style="background: var(--accent-success-bg); border-color: rgba(16, 185, 129, 0.2);">
            <span class="metric-label text-green">Total PnL</span>
            <span id="pos-pnl" class="metric-value text-green">₹0.00</span>
          </div>
          <div style="display: flex; gap: 12px;">
              <div class="metric-card" style="flex: 1;">
                <span class="metric-label">Quantity</span>
                <span id="pos-qty" class="metric-value">0</span>
              </div>
              <div class="metric-card" style="flex: 1;">
                <span class="metric-label">Avg Price</span>
                <span id="pos-avg" class="metric-value">₹0.00</span>
              </div>
              <div class="metric-card" style="flex: 1;">
                <span class="metric-label">Time in Trade</span>
                <span id="pos-time" class="metric-value mono" style="font-size: 1.2rem;">--:--</span>
              </div>
          </div>
        </div>
      </section>

      <!-- Advanced Bot Intelligence Engine -->
      <section class="bento-item bot-intel-section">
        <div class="bento-header" style="margin-bottom: 16px;">
          <h2 class="bento-title">Bot Intelligence</h2>
          <span class="badge ec2">EC2 Engine</span>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 12px; flex-grow: 1;">
          <!-- State Engine output -->
          <div class="metric-card">
            <span class="metric-label">Market Regime</span>
            <span id="intel-regime" class="metric-value" style="font-size: 1.1rem; color: var(--accent-info);">Analyzing Variance...</span>
          </div>
          
          <!-- Confluence Meter -->
          <div class="metric-card">
            <div class="metric-label">
              <span>Signal Confluence</span>
              <span id="intel-score-txt" class="mono">0%</span>
            </div>
            <div class="progress-bar">
               <div id="intel-score-fill" class="progress-fill" style="width: 0%; background: var(--text-secondary);"></div>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 4px;">
               <span class="badge" id="badge-macd">MACD</span>
               <span class="badge" id="badge-vwap">VWAP</span>
               <span class="badge" id="badge-pcr">PCR</span>
            </div>
          </div>

          <!-- Intraday Signal Heatmap -->
          <div class="metric-card">
            <span class="metric-label">Intraday Signal Heatmap</span>
            <div id="signal-heatmap" style="display: flex; gap: 4px; margin-top: 8px; height: 24px;">
              <!-- Injected via dashboard.js -->
            </div>
          </div>

          <!-- Open Interest Profile -->
          <div class="metric-card">
            <span class="metric-label">ATM Open Interest (OI) Profile</span>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
              <span id="oi-put-label" style="color: var(--accent-sell); font-size: 11px; font-family: var(--font-mono); font-weight: bold; width: 40px; text-align: right;">PE 0%</span>
              <div style="flex-grow: 1; height: 8px; border-radius: 4px; display: flex; overflow: hidden; background: rgba(255,255,255,0.1);">
                <div id="oi-put-fill" style="width: 50%; background: var(--accent-sell); transition: width 0.5s ease;"></div>
                <div id="oi-call-fill" style="width: 50%; background: var(--accent-buy); transition: width 0.5s ease;"></div>
              </div>
              <span id="oi-call-label" style="color: var(--accent-buy); font-size: 11px; font-family: var(--font-mono); font-weight: bold; width: 40px;">0% CE</span>
            </div>
          </div>

          <!-- Execution Queue / Iceberg -->
          <div class="metric-card" style="background: rgba(255,255,255,0.01);">
            <span class="metric-label">Active Task</span>
            <span id="intel-task" class="mono" style="font-size: 0.85rem; color: var(--text-secondary);">Idle. Waiting for setup.</span>
          </div>

          <!-- 🟢 AI Consensus Gauge 🟢 -->
          <div class="metric-card" id="consensus-gauge-card" style="display: none;">
            <span class="metric-label">Ensemble Consensus</span>
            <div id="consensus-gauge" style="margin-top: 8px; width: 100%; height: 16px; border-radius: 4px; overflow: hidden; display: flex; background: rgba(255,255,255,0.05);">
               <!-- Injected via dashboard.js -->
            </div>
            <div id="consensus-gauge-labels" style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-top: 4px; font-family: var(--font-mono);">
            </div>
            <!-- Reasoning snippet -->
            <div id="consensus-reasoning" style="margin-top: 8px; font-size: 11px; color: var(--text-muted); font-style: italic; border-left: 2px solid rgba(255,255,255,0.1); padding-left: 8px;">
            </div>
          </div>

          <!-- 🟢 AI Ensemble Visualizer 🟢 -->
          <div id="ensemble-visualizer" style="display: none;">
             <!-- Injected via dashboard.js -->
          </div>

          <!-- Thought Process Terminal -->
          <div id="thought-process-terminal" style="display: none; margin-top: 12px;">
             <!-- Injected via dashboard.js -->
          </div>
        </div>
      </section>

      <!-- Differentiated Terminal Logs -->
      <section class="bento-item logs-section">
        <div class="bento-header" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
          <h2 class="bento-title">System Execution Logs</h2>
          <div style="display: flex; gap: 8px; align-items: center;">
            <div class="log-tabs">
              <button class="log-tab active" data-filter="all">All</button>
              <button class="log-tab" data-filter="trade">Trades</button>
              <button class="log-tab" data-filter="ec2">EC2 Daemon</button>
              <button class="log-tab" data-filter="error">Errors</button>
            </div>
            <button id="log-export-btn" class="btn btn-outline" style="padding: 4px 8px; font-size: 11px;" title="Export Logs to CSV">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>
        </div>
        <div id="system-logs" class="terminal">
          <!-- Logs injected by JS -->
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
                <th>Ticker</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="ledger-body">
              <tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Waiting for orders...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Equity Curve -->
      <section class="bento-item equity-section">
        <div class="bento-header">
          <h2 class="bento-title">Equity Curve</h2>
        </div>
        <div style="width: 100%; height: 100%; position: relative; min-height: 200px;">
          <canvas id="equity-chart"></canvas>
        </div>
      </section>

      <!-- AI Leaderboard -->
      <section class="bento-item leaderboard-section">
        <div class="bento-header">
          <h2 class="bento-title">🌐 AI Leaderboard</h2>
        </div>
        <div id="ai-leaderboard" style="overflow-x: auto; width: 100%;">
           <!-- Injected via dashboard.js -->
           <p style="color: var(--text-secondary); text-align: center; padding: 20px;">Loading leaderboard...</p>
        </div>
      </section>

      <!-- Persona Settings -->
      <section class="bento-item persona-section">
        <div class="bento-header">
          <h2 class="bento-title">⚙️ Bot Persona & Risk Matrix</h2>
        </div>
        <div id="persona-settings" style="display: flex; flex-direction: column; gap: 8px;">
           <!-- Injected via dashboard.js -->
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

  <!-- Heatmap Tooltip -->
  <div id="heatmap-tooltip" style="position: absolute; display: none; z-index: 10000; background: rgba(10,10,10,0.9); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 6px; font-size: 12px; pointer-events: none; color: var(--text-primary); backdrop-filter: blur(4px);"></div>

  <script src="/chart.js"></script>
  <script src="/dashboard.js"></script>
</body>
</html>`;

  return c.html(html);
});

export default dashboard;
