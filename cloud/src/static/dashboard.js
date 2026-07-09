// ============================================
// Dashboard Client-Side Logic
// Polling, controls, real-time updates
// ============================================

(function () {
  'use strict';

  const POLL_INTERVAL = 3000;
  let chart = null;
  let pollTimer = null;
  let currentStatus = 'STOPPED';

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

    currentStatus = data.status;

    // Status badge
    const badge = document.getElementById('status-badge');
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (badge && dot && statusText) {
      badge.className = 'status-badge ' + data.status.toLowerCase();
      dot.className = 'status-dot ' + data.status.toLowerCase();
      statusText.textContent = data.status;
    }

    // Update Toggle Button label & style
    const toggleBtn = document.getElementById('toggle-bot-btn');
    if (toggleBtn) {
      if (data.status === 'RUNNING') {
        toggleBtn.textContent = '■ Stop Autonomous Trading';
        toggleBtn.classList.add('running');
      } else {
        toggleBtn.textContent = '▶ Start Autonomous Trading';
        toggleBtn.classList.remove('running');
      }
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
    const noPosEl = document.getElementById('no-position');
    const activePosEl = document.getElementById('active-position');
    
    if (noPosEl && activePosEl) {
      if (data.activePosition) {
        const p = data.activePosition;
        
        // Hide the "Searching..." text, show the grid
        noPosEl.style.display = 'none';
        activePosEl.style.display = 'grid';
        
        // Update the specific metric spans
        document.getElementById('pos-symbol').textContent = p.tradingSymbol;
        document.getElementById('pos-entry').textContent = `₹${p.entryPrice.toFixed(2)}`;
        
        // Note: LTP and PnL require real-time Upstox data, 
        // they will populate as your bot fetches them in the background.
        document.getElementById('pos-ltp').textContent = 'Tracking...'; 
        
      } else {
        // Show the "Searching..." text, hide the grid
        noPosEl.style.display = 'flex';
        activePosEl.style.display = 'none';
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
    const res = await fetch('/api/telemetry?limit=100');
    const data = await res.json();
    const consoleEl = document.getElementById('system-logs');
    if (!consoleEl || !data.data) return;

    consoleEl.innerHTML = data.data.map(entry => {
      // Parse UTC to IST
      const ts = formatIST(entry.timestamp);
      const msg = entry.log_message || `MACD: ${parseFloat(entry.macd_line).toFixed(4)}`;
      const spot = entry.nifty_spot ? parseFloat(entry.nifty_spot).toFixed(2) : '---';

      // Dynamic Color Coding
      let level = 'INFO';
      let color = 'var(--text-muted)';
      
      if (msg.includes('ERROR')) { 
        level = 'ERR'; color = 'var(--accent-sell)'; 
      } else if (msg.includes('WARN') || msg.includes('SKIP') || msg.includes('Deadlock')) { 
        level = 'WARN'; color = '#f59e0b'; // Orange
      } else if (msg.includes('SIGNAL') || msg.includes('EXIT')) { 
        level = 'TRD'; color = 'var(--accent-buy)'; 
      } else if (msg.includes('AUTO_SQUAREOFF')) { 
        level = 'TRD'; color = 'var(--accent-blue)'; 
      }

      // Flexbox grid for perfectly aligned log columns
      return `<div style="display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03); color: ${color}; font-family: var(--font-mono);">
        <span style="width: 70px; flex-shrink: 0; font-weight: 500; opacity: 0.8;">${ts}</span>
        <span style="width: 50px; flex-shrink: 0; font-weight: 700;">[${level}]</span>
        <span style="width: 95px; flex-shrink: 0; color: var(--text-primary);">Spot: ${spot}</span>
        <span style="flex-grow: 1; word-break: break-word;">${escapeHtml(msg)}</span>
      </div>`;
    }).join('');

    consoleEl.scrollTop = consoleEl.scrollHeight; // Auto-scroll to bottom
  }

  // --- Orders ---
  async function fetchOrders() {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('ledger-body');
    if (!tbody || !data.data) return;

    tbody.innerHTML = data.data.map(o => {
      const statusClass = o.order_status === 'FILLED' ? 'text-green' :
                          o.order_status === 'REJECTED' ? 'text-red' : 'text-muted';
      const time = formatIST(o.created_at);
      const pnl = o.pnl || 0;
      const pnlClass = pnl > 0 ? 'text-green' : (pnl < 0 ? 'text-red' : 'text-muted');
      const typeColor = o.transaction_type === 'BUY' ? 'var(--accent-buy)' : 'var(--accent-sell)';

      return `<tr>
        <td style="font-family: var(--font-mono); color: var(--text-muted);">${time}</td>
        <td style="font-weight: 600;">${o.trading_symbol || '--'}</td>
        <td style="color: ${typeColor}; font-weight: bold;">${o.transaction_type} ${o.option_type}</td>
        <td>${o.lots || 0} (${o.quantity || 0})</td>
        <td style="font-family: var(--font-mono);">₹${(o.execution_price || o.order_price || 0).toFixed(2)}</td>
        <td class="${statusClass}" style="font-weight: 600;">${o.order_status}</td>
        <td class="${pnlClass}" style="font-family: var(--font-mono); font-weight: 700;">
          ${pnl > 0 ? '+' : ''}₹${pnl.toFixed(2)}
        </td>
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
    const toggleBtn = document.getElementById('toggle-bot-btn');
    const btnEmergency = document.getElementById('emergency-btn');

    // NEW: Manual Trade Injection
    const btnManualCE = document.getElementById('manual-ce-btn');
    const btnManualPE = document.getElementById('manual-pe-btn');

    async function handleManualEntry(direction) {
      if (!confirm(`Are you sure you want to force enter a ${direction} position?\n\nThe bot will automatically manage the Stop-Loss and exits once executed.`)) return;
      
      try {
        const res = await fetch('/api/manual-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction })
        });
        
        const data = await res.json();
        if (data.error) {
          alert(`❌ Error: ${data.error}`);
        } else {
          // Temporarily show success on the UI
          const targetBtn = direction === 'CE' ? btnManualCE : btnManualPE;
          const originalText = targetBtn.textContent;
          targetBtn.textContent = '✅ Dispatched!';
          setTimeout(() => targetBtn.textContent = originalText, 2000);
          
          fetchStatus(); // Refresh dashboard
        }
      } catch (e) {
        alert('Network error connecting to Cloudflare Worker.');
      }
    }

    if (btnManualCE) btnManualCE.addEventListener('click', () => handleManualEntry('CE'));
    if (btnManualPE) btnManualPE.addEventListener('click', () => handleManualEntry('PE'));

    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        const action = currentStatus === 'RUNNING' ? 'STOP' : 'START';
        if (!confirm(`${action === 'START' ? 'Start' : 'Stop'} the trading bot?`)) return;
        await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
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
            btnEmergency.textContent = '🚨 EMERGENCY SQUARE-OFF';
          }, 3000);
        } else if (clickCount >= 2) {
          clearTimeout(clickTimer);
          clickCount = 0;
          btnEmergency.textContent = '🚨 EMERGENCY SQUARE-OFF';
          fetch('/api/emergency-squareoff', { method: 'POST' })
            .then(() => fetchStatus());
        }
      });
    }

    // Risk slider (if exists)
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

  // NEW: Robust UTC to IST Time Converter
  function formatIST(dbDateString) {
    if (!dbDateString) return '--:--:--';
    
    // Check if SQLite returned a raw string without a timezone specifier
    let parseStr = dbDateString;
    if (!parseStr.includes('Z') && !parseStr.includes('+')) {
      // Force it to be parsed as UTC by appending 'Z'
      parseStr = parseStr.replace(' ', 'T') + 'Z';
    }
    
    const d = new Date(parseStr);
    if (isNaN(d.getTime())) return dbDateString; // Fallback if parse fails
    
    return d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // 24-hour format (e.g., 14:30:45) is best for trading logs
    });
  }
})();
