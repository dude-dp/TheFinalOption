// ============================================
// Dashboard Client-Side Logic
// Polling, controls, real-time updates
// ============================================

(function () {
  'use strict';

  const POLL_INTERVAL = 3000;
  let chart = null;
  let pollTimer = null;

  // --- Init ---
  document.addEventListener('DOMContentLoaded', () => {
    chart = new window.TradingChart('trading-chart');
    startPolling();
    bindControls();
  });

  // --- Polling Loop ---
  function startPolling() {
    fetchAll();
    pollTimer = setInterval(fetchAll, POLL_INTERVAL);
  }

  async function fetchAll() {
    try {
      await Promise.all([
        fetchStatus(),
        fetchChartData(),
        fetchTelemetry(),
        fetchOrders(),
        fetchSummary(),
      ]);
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  // --- Status ---
  async function fetchStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Status badge
    const badge = document.getElementById('status-badge');
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (badge && dot && statusText) {
      badge.className = 'status-badge ' + data.status.toLowerCase();
      dot.className = 'status-dot ' + data.status.toLowerCase();
      statusText.textContent = data.status;
    }

    // Token indicator
    const tokenEl = document.getElementById('token-status');
    if (tokenEl) {
      tokenEl.textContent = data.hasAccessToken ? '🔑 Token Active' : '⚠️ No Token';
      tokenEl.style.color = data.hasAccessToken ? '#39ff14' : '#ff073a';
    }

    // Update Margin
    const marginEl = document.getElementById('margin-value');
    if (marginEl) {
      if (data.margin && data.margin.availableMargin !== undefined) {
        marginEl.textContent = '₹' + data.margin.availableMargin.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      } else {
        marginEl.textContent = '₹---';
      }
    }

    // Active position
    const posContainer = document.getElementById('position-container');
    if (posContainer) {
      if (data.activePosition) {
        const p = data.activePosition;
        const pnlClass = 'metric-value'; // Will be updated with LTP
        posContainer.innerHTML = `
          <div class="position-card">
            <div class="metric">
              <span class="metric-label">Symbol</span>
              <span class="metric-value">${p.tradingSymbol}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Type</span>
              <span class="option-badge ${p.optionType.toLowerCase()}">${p.optionType}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Strike</span>
              <span class="metric-value">${p.strikePrice}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Entry Price</span>
              <span class="metric-value">₹${p.entryPrice.toFixed(2)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Lots</span>
              <span class="metric-value">${p.lots}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Quantity</span>
              <span class="metric-value">${p.quantity}</span>
            </div>
          </div>
        `;
      } else {
        posContainer.innerHTML = '<p class="no-position">No active position</p>';
      }
    }
  }

  // --- Chart Data ---
  async function fetchChartData() {
    const res = await fetch('/api/chart-data');
    const data = await res.json();
    if (chart && data.spots) {
      chart.updateData(data.spots, data.macd);
    }
  }

  // --- Telemetry (System Log) ---
  async function fetchTelemetry() {
    const res = await fetch('/api/telemetry?limit=80');
    const data = await res.json();
    const console = document.getElementById('log-console');
    if (!console || !data.data) return;

    console.innerHTML = data.data.map(entry => {
      const ts = entry.timestamp ? entry.timestamp.split('T')[1]?.substring(0, 8) || '' : '';
      const msg = entry.log_message || `SPOT=${entry.nifty_spot} MACD=${parseFloat(entry.macd_line).toFixed(4)}`;
      let level = 'info';
      if (msg.includes('ERROR')) level = 'error';
      else if (msg.includes('SKIP') || msg.includes('WARN')) level = 'warn';
      else if (msg.includes('SIGNAL')) level = 'signal';

      return `<div class="log-entry ${level}">` +
        `<span class="timestamp">${ts}</span>` +
        `<span class="level">[${level.toUpperCase()}]</span> ` +
        `<span class="message">${escapeHtml(msg)}</span>` +
        `</div>`;
    }).join('');

    console.scrollTop = console.scrollHeight;
  }

  // --- Orders ---
  async function fetchOrders() {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('orders-tbody');
    if (!tbody || !data.data) return;

    tbody.innerHTML = data.data.map(o => {
      const statusClass = o.order_status === 'FILLED' ? 'status-filled' :
        o.order_status === 'REJECTED' ? 'status-rejected' : 'status-pending';
      const time = o.created_at ? o.created_at.split('T')[1]?.substring(0, 8) || '' : '';
      const pnl = o.pnl || 0;
      const pnlClass = pnl >= 0 ? 'profit' : 'loss';

      return `<tr>
        <td>${time}</td>
        <td>${o.trading_symbol || ''}</td>
        <td><span class="option-badge ${(o.option_type || '').toLowerCase()}">${o.transaction_type} ${o.option_type}</span></td>
        <td>${o.lots || 0} (${o.quantity || 0})</td>
        <td>₹${(o.execution_price || o.order_price || 0).toFixed(2)}</td>
        <td class="${statusClass}">${o.order_status}</td>
        <td class="metric-value ${pnlClass}">${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}</td>
      </tr>`;
    }).join('');
  }

  // --- Summary ---
  async function fetchSummary() {
    const res = await fetch('/api/summary');
    const data = await res.json();
    const container = document.getElementById('summary-container');
    if (!container) return;

    if (data.data) {
      const d = data.data;
      const pnlClass = (d.total_pnl || 0) >= 0 ? 'profit' : 'loss';
      container.innerHTML = `
        <div class="summary-stats">
          <div class="summary-stat">
            <span class="label">Trades</span>
            <span class="value">${d.total_trades || 0}</span>
          </div>
          <div class="summary-stat">
            <span class="label">Wins</span>
            <span class="value" style="color: var(--accent-buy)">${d.winning_trades || 0}</span>
          </div>
          <div class="summary-stat">
            <span class="label">P&L</span>
            <span class="value metric-value ${pnlClass}">₹${(d.total_pnl || 0).toFixed(2)}</span>
          </div>
        </div>
        <div class="summary-content">${escapeHtml(d.ai_summary || 'No summary available yet.')}</div>
      `;
    } else {
      container.innerHTML = '<p class="no-position">No summary available — generated at market close.</p>';
    }
  }

  // --- Control Bindings ---
  function bindControls() {
    // Start/Stop toggle
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnEmergency = document.getElementById('btn-emergency');
    const btnAuth = document.getElementById('btn-auth');

    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        if (!confirm('Start the trading bot?')) return;
        await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'START' }),
        });
        fetchStatus();
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', async () => {
        if (!confirm('Stop the trading bot?')) return;
        await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'STOP' }),
        });
        fetchStatus();
      });
    }

    if (btnEmergency) {
      let clickCount = 0;
      let clickTimer = null;
      btnEmergency.addEventListener('click', () => {
        clickCount++;
        if (clickCount === 1) {
          btnEmergency.textContent = '⚠️ Click Again to Confirm';
          clickTimer = setTimeout(() => {
            clickCount = 0;
            btnEmergency.textContent = '🚨 Emergency Square-Off';
          }, 3000);
        } else if (clickCount >= 2) {
          clearTimeout(clickTimer);
          clickCount = 0;
          btnEmergency.textContent = '🚨 Emergency Square-Off';
          fetch('/api/emergency-squareoff', { method: 'POST' })
            .then(() => fetchStatus());
        }
      });
    }

    if (btnAuth) {
      btnAuth.addEventListener('click', () => {
        window.open('/api/auth/login', '_blank', 'width=500,height=600');
      });
    }

    // Risk slider
    const riskSlider = document.getElementById('risk-slider');
    const riskValue = document.getElementById('risk-value');
    if (riskSlider && riskValue) {
      riskSlider.addEventListener('input', (e) => {
        riskValue.textContent = e.target.value + '%';
      });
      riskSlider.addEventListener('change', async (e) => {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_risk_pct: e.target.value }),
        });
      });
    }
  }

  // --- Utils ---
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
