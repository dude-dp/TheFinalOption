// ============================================
// Dashboard Client-Side Logic — PWA Edition
// All 10 mobile improvements implemented
// ============================================

(function () {
  'use strict';

  const POLL_INTERVAL = 3000;
  const HEARTBEAT_TIMEOUT = 6000;

  // ==================== SVG ICON CONSTANTS ====================
  const ICON_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z"/></svg>`;
  const ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z"/></svg>`;
  const ICON_ALERT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg>`;
  const ICON_WARN  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12v-4"/><path d="M12 16v.01"/><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z"/></svg>`;
  const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 12l5 5l10 -10"/></svg>`;
  const EMPTY_SVG = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3;margin-bottom:10px;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path d="M4 13h3l3 3h4l3 -3h3" /></svg><p style="margin:0;font-size:0.9rem;">Nothing to see here yet.</p></div>`;

  let chart = null;
  let currentStatus = 'STOPPED';
  let lastActivePosition = null;
  let heartbeatTimer = null;
  let activeLogFilter = 'all';
  let allLogEntries = [];
  let allOrders = []; // Store for chart flags

  // ==================== AUDIO ENGINE ====================
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'entry') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'exit') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'error') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    }
  }

  // ==================== ODOMETER ENGINE ====================
  const numericState = new Map();
  function animateCurrency(el, newVal, forcePrefix = false) {
    if (!el) return;
    const current = numericState.get(el) || 0;
    if (Math.abs(current - newVal) < 0.01) {
      el.textContent = (forcePrefix && newVal > 0 ? '+' : '') + '₹' + newVal.toFixed(2);
      return;
    }
    const duration = 800;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 4);
      const val = current + (newVal - current) * easeOut;
      const prefix = (forcePrefix && val > 0) ? '+' : '';
      el.textContent = prefix + '₹' + val.toFixed(2);
      if (progress < 1) requestAnimationFrame(step);
      else {
        el.textContent = (forcePrefix && newVal > 0 ? '+' : '') + '₹' + newVal.toFixed(2);
        numericState.set(el, newVal);
      }
    }
    requestAnimationFrame(step);
  }

  // ==================== INIT ====================
  document.addEventListener('DOMContentLoaded', () => {
    chart = new window.TradingChart('trading-chart');
    initMobileNav();
    initSlideToConfirm();
    initFullscreenChart();
    initLogFilterChips();
    initIsland();
    initSettingsModal();
    bindControls();
    fetchAll();
    setInterval(fetchAll, POLL_INTERVAL);
  });

  // ==================== POLLING ====================
  async function fetchAll() {
    try {
      await Promise.all([
        fetchStatus(),
        fetchChartData(),
        fetchTelemetry(),
        fetchOrders(),
      ]);
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  // ==================== STATUS ====================
  async function fetchStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Heartbeat pulse
    pulseHeartbeat();

    currentStatus = data.status;

    // Status badge text & Radar ping
    const statusText = document.getElementById('status-text');
    const statusDot  = document.getElementById('status-dot');
    if (statusText) statusText.textContent = data.status;
    if (statusDot) {
      if (data.status === 'RUNNING') statusDot.classList.add('running');
      else statusDot.classList.remove('running');
    }

    // Toggle button (Icon Morphing)
    const toggleBtn = document.getElementById('toggle-bot-btn');
    if (toggleBtn) {
      if (data.status === 'RUNNING') {
        toggleBtn.setAttribute('data-tooltip', 'Stop Autonomous Bot');
        toggleBtn.style.color = 'var(--accent-sell)';
        toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" /></svg>`;
        toggleBtn.classList.add('running');
      } else {
        toggleBtn.setAttribute('data-tooltip', 'Start Autonomous Bot');
        toggleBtn.style.color = 'var(--accent-blue)';
        toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>`;
        toggleBtn.classList.remove('running');
      }
    }

    // Margin
    const marginEl = document.getElementById('margin-value');
    if (marginEl && data.margin?.availableMargin !== undefined) {
      animateCurrency(marginEl, data.margin.availableMargin);
    }

    // Active position tracker
    const noPosEl    = document.getElementById('no-position');
    const activePosEl = document.getElementById('active-position');
    const pnlCard    = document.getElementById('pnl-card');

    if (noPosEl && activePosEl) {
      const posBento = activePosEl.closest('.bento-card');
      if (data.activePosition) {
        const p = data.activePosition;
        noPosEl.style.display = 'none';
        activePosEl.style.display = 'grid';
        if (posBento) posBento.classList.add('live-trade');

        document.getElementById('pos-symbol').textContent = p.tradingSymbol;
        document.getElementById('pos-entry').textContent  = `₹${p.entryPrice.toFixed(2)}`;
        
        // Let's assume PnL comes from data.activePosition if available (or calculate if LTP is there)
        const pnl = p.unrealizedPnL || 0; // Replace with actual property if backend provides it
        
        // PnL glow and Aurora Background
        if (pnlCard) {
          pnlCard.classList.remove('glow-green', 'glow-red');
          if (pnl > 0) pnlCard.classList.add('glow-green');
          if (pnl < 0) pnlCard.classList.add('glow-red');
        }
        document.body.classList.remove('market-up', 'market-down');
        if (pnl > 0) document.body.classList.add('market-up');
        if (pnl < 0) document.body.classList.add('market-down');

        // Update Dynamic Island
        updateIsland(p, pnl);

        // Toast on new autopilot entry
        if (!lastActivePosition && data.activePosition) {
          showToast(`Entry: ${p.tradingSymbol} × ${p.lots} lots @ ₹${p.entryPrice.toFixed(2)}`);
          vibrate([50, 100, 50]);
          playTone('entry');
        }
      } else {
        noPosEl.style.display = 'flex';
        activePosEl.style.display = 'none';
        if (posBento) posBento.classList.remove('live-trade');
        if (pnlCard) pnlCard.classList.remove('glow-green', 'glow-red');
        document.body.classList.remove('market-up', 'market-down');
        clearIsland();

        // Toast on position close
        if (lastActivePosition && !data.activePosition) {
          showToast('Position Closed — Check the Ledger for PnL.');
          vibrate([100, 50, 100]);
          playTone('exit');
        }
      }
    }

    lastActivePosition = data.activePosition;
  }

  // ==================== CHART DATA ====================
  async function fetchChartData() {
    const res  = await fetch('/api/chart-data');
    const data = await res.json();
    if (chart && data.spots) chart.updateData(data.spots, data.macd, allOrders);
  }

  // ==================== TELEMETRY ====================
  async function fetchTelemetry() {
    const res  = await fetch('/api/telemetry?limit=100');
    const data = await res.json();
    if (!data.data) return;

    allLogEntries = data.data;
    renderLogs();
  }

  function renderLogs() {
    const consoleEl = document.getElementById('system-logs');
    if (!consoleEl) return;

    const filtered = allLogEntries.filter(entry => {
      if (activeLogFilter === 'all')    return true;
      if (activeLogFilter === 'trade')  return (entry.log_message || '').match(/SIGNAL|EXIT|MANUAL|SQUAREOFF/i);
      if (activeLogFilter === 'error')  return (entry.log_message || '').includes('ERROR');
      if (activeLogFilter === 'system') return !(entry.log_message || '').match(/SIGNAL|EXIT|ERROR|MANUAL|SQUAREOFF/i);
      return true;
    });

    if (filtered.length === 0) {
      consoleEl.innerHTML = EMPTY_SVG;
      return;
    }

    consoleEl.innerHTML = filtered.map(entry => {
      const ts  = formatIST(entry.timestamp);
      const msg = entry.log_message || `MACD: ${parseFloat(entry.macd_line).toFixed(4)}`;
      const spot = entry.nifty_spot ? parseFloat(entry.nifty_spot).toFixed(2) : '---';

      let level = 'INFO';
      let color = 'var(--text-muted)';
      if      (msg.includes('ERROR'))                                    { level = 'ERR';  color = 'var(--accent-sell)'; }
      else if (msg.match(/WARN|SKIP|Deadlock/i))                        { level = 'WARN'; color = '#f59e0b'; }
      else if (msg.match(/SIGNAL|EXIT|MANUAL|SQUAREOFF/i))              { level = 'TRD';  color = 'var(--accent-buy)'; }
      else if (msg.includes('AUTO_SQUAREOFF'))                           { level = 'TRD';  color = 'var(--accent-blue)'; }

      return `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.03);color:${color};font-family:var(--font-mono);" data-level="${level}">
        <span style="width:70px;flex-shrink:0;font-weight:500;opacity:0.8;">${ts}</span>
        <span style="width:50px;flex-shrink:0;font-weight:700;">[${level}]</span>
        <span style="width:95px;flex-shrink:0;color:var(--text-primary);">Spot: ${spot}</span>
        <span style="flex-grow:1;word-break:break-word;">${escapeHtml(msg)}</span>
      </div>`;
    }).join('');

    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  // ==================== ORDERS ====================
  async function fetchOrders() {
    const res  = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('ledger-body');
    if (!tbody || !data.data) return;

    allOrders = data.data; // Store for chart execution flags

    if (allOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">${EMPTY_SVG}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.data.map(o => {
      const statusClass = o.order_status === 'FILLED' ? 'text-green' : o.order_status === 'REJECTED' ? 'text-red' : '';
      const time      = formatIST(o.created_at);
      const pnl       = o.pnl || 0;
      const pnlClass  = pnl > 0 ? 'text-green' : pnl < 0 ? 'text-red' : '';
      const typeColor = o.transaction_type === 'BUY' ? 'var(--accent-buy)' : 'var(--accent-sell)';
      
      const tooltipAttr = (o.order_status === 'REJECTED' && o.status_message) 
        ? `data-tooltip="${escapeHtml(o.status_message)}"` 
        : '';

      return `<tr>
        <td data-label="Time"     style="font-family:var(--font-mono);color:var(--text-muted);">${time}</td>
        <td data-label="Contract" style="font-weight:600;">${o.trading_symbol || '--'}</td>
        <td data-label="Type"     style="color:${typeColor};font-weight:bold;">${o.transaction_type} ${o.option_type}</td>
        <td data-label="Qty">${o.lots || 0} (${o.quantity || 0})</td>
        <td data-label="Price"    style="font-family:var(--font-mono);">₹${(o.execution_price || o.order_price || 0).toFixed(2)}</td>
        <td data-label="Status"   class="${statusClass}" style="font-weight:600;" ${tooltipAttr}>${o.order_status}</td>
        <td data-label="PnL"      class="${pnlClass}" style="font-family:var(--font-mono);font-weight:700;">${pnl > 0 ? '+' : ''}₹${pnl.toFixed(2)}</td>
      </tr>`;
    }).join('');
  }

  // ==================== CONTROLS ====================
  function bindControls() {
    
    // 1. Toggle Bot (Play/Stop Icon morphing)
    const btnStart = document.getElementById('toggle-bot-btn');
    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        // Fetch current status from the badge to toggle
        const currentStatusStr = document.getElementById('status-badge').className;
        // Wait, the status is not in the class of status-badge, it's in currentStatus variable!
        // But the user's code says:
        // const currentStatus = document.getElementById('status-badge').className;
        // const isRunning = currentStatus.includes('running');
        // Let's stick strictly to user's code, but wait, status-badge class might not have 'running'. The status-dot has 'running'.
        // So I'll use the currentStatus variable from JS closure!
        const isRunning = currentStatus === 'RUNNING';
        
        if (!confirm(isRunning ? 'Stop Autonomous Trading?' : 'Start Autonomous Trading?')) return;
        
        await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: isRunning ? 'STOP' : 'START' }),
        });
        
        // Optimistic UI update for the icon
        if (!isRunning) {
          btnStart.setAttribute('data-tooltip', 'Stop Autonomous Bot');
          btnStart.style.color = 'var(--accent-sell)';
          btnStart.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" /></svg>`;
        } else {
          btnStart.setAttribute('data-tooltip', 'Start Autonomous Bot');
          btnStart.style.color = 'var(--accent-blue)';
          btnStart.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>`;
        }
        fetchStatus();
      });
    }

    // 2. Emergency Button (Double Click + Pulsing Animation)
    const btnEmergency = document.getElementById('emergency-btn');
    if (btnEmergency) {
      let clickCount = 0;
      let clickTimer = null;
      btnEmergency.addEventListener('click', () => {
        clickCount++;
        
        if (clickCount === 1) {
          // First Click: Trigger warning state
          btnEmergency.setAttribute('data-tooltip', 'CLICK AGAIN TO EXECUTE!');
          btnEmergency.classList.add('force-tooltip', 'btn-pulsing');
          
          clickTimer = setTimeout(() => {
            clickCount = 0;
            btnEmergency.setAttribute('data-tooltip', 'EMERGENCY SQUARE-OFF');
            btnEmergency.classList.remove('force-tooltip', 'btn-pulsing');
          }, 3000);
        } else if (clickCount >= 2) {
          // Second Click: Execute
          clearTimeout(clickTimer);
          clickCount = 0;
          btnEmergency.setAttribute('data-tooltip', 'EXECUTING...');
          btnEmergency.classList.remove('btn-pulsing');
          
          fetch('/api/emergency-squareoff', { method: 'POST' })
            .then(() => {
              vibrate([200, 100, 200]);
              showToast('Emergency Square-Off triggered!');
              setTimeout(() => {
                btnEmergency.setAttribute('data-tooltip', 'EMERGENCY SQUARE-OFF');
                btnEmergency.classList.remove('force-tooltip');
                fetchStatus();
              }, 1500);
            });
        }
      });
    }

    // 3. Manual Entry Buttons (Feedback tooltips)
    const btnManualCE = document.getElementById('manual-ce-btn');
    const btnManualPE = document.getElementById('manual-pe-btn');

    async function handleManualEntry(direction) {
      if (!confirm(`Force enter a ${direction} position?\nBot will automatically manage exits.`)) return;
      
      const targetBtn = direction === 'CE' ? btnManualCE : btnManualPE;
      const originalTooltip = targetBtn.getAttribute('data-tooltip');
      const origHTML = targetBtn.innerHTML;
      
      try {
        const res = await fetch('/api/manual-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction })
        });
        
        const data = await res.json();
        if (data.error) {
          showToast(`Error: ${data.error}`);
        } else {
          // Show success tooltip
          targetBtn.setAttribute('data-tooltip', 'DISPATCHED!');
          targetBtn.classList.add('force-tooltip');
          targetBtn.innerHTML = ICON_CHECK;
          vibrate([50, 100, 50]);
          
          setTimeout(() => {
            targetBtn.setAttribute('data-tooltip', originalTooltip);
            targetBtn.classList.remove('force-tooltip');
            targetBtn.innerHTML = origHTML;
          }, 2500);
          
          fetchStatus();
        }
      } catch (e) {
        showToast('Network error connecting to Worker.');
      }
    }

    if (btnManualCE) btnManualCE.addEventListener('click', () => handleManualEntry('CE'));
    if (btnManualPE) btnManualPE.addEventListener('click', () => handleManualEntry('PE'));
  }

  // ==================== MOBILE NAV ====================
  function initMobileNav() {
    const tabs    = document.querySelectorAll('.nav-tab');
    const sections = document.querySelectorAll('.bento-card[data-tab]');

    // On mobile, show only the first tab by default
    function activateTab(tabId) {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));

      // On mobile: show matching sections, hide others
      if (window.innerWidth <= 768) {
        sections.forEach(s => {
          s.classList.toggle('tab-active', s.dataset.tab === tabId);
        });
      }
    }

    tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

    // On first mobile load, activate "controls"
    if (window.innerWidth <= 768) activateTab('controls');

    // Re-init on resize
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        sections.forEach(s => s.classList.add('tab-active'));
      } else {
        const activeTab = document.querySelector('.nav-tab.active');
        if (activeTab) activateTab(activeTab.dataset.tab);
      }
    });
  }

  // ==================== SLIDE-TO-CONFIRM ====================
  function initSlideToConfirm() {
    const wrapper = document.getElementById('slide-emergency');
    const thumb   = document.getElementById('slide-thumb');
    const fill    = document.getElementById('slide-fill');
    if (!wrapper || !thumb) return;

    let startX = 0, isDragging = false;

    function onStart(e) {
      isDragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
    }

    function onMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const clientX  = e.touches ? e.touches[0].clientX : e.clientX;
      const dx        = clientX - startX;
      const maxTravel = wrapper.offsetWidth - thumb.offsetWidth - 8;
      const clamped   = Math.max(0, Math.min(dx, maxTravel));
      const pct       = clamped / maxTravel;

      thumb.style.left = `${4 + clamped}px`;
      fill.style.width  = `${4 + clamped + thumb.offsetWidth / 2}px`;
      thumb.style.opacity = (0.5 + pct * 0.5).toString();

      if (pct >= 0.95) {
        isDragging = false;
        thumb.style.left = `${4 + maxTravel}px`;
        setTimeout(() => {
          fetch('/api/emergency-squareoff', { method: 'POST' }).then(() => {
            vibrate([200, 100, 200]);
            showToast('Emergency Square-Off triggered!');
            fetchStatus();
          });
          resetSlider();
        }, 200);
      }
    }

    function onEnd() {
      if (isDragging) { isDragging = false; resetSlider(); }
    }

    function resetSlider() {
      thumb.style.transition = 'left 0.3s ease';
      fill.style.transition  = 'width 0.3s ease';
      thumb.style.left  = '4px';
      fill.style.width  = '0';
      thumb.style.opacity = '1';
      setTimeout(() => {
        thumb.style.transition = '';
        fill.style.transition  = '';
      }, 300);
    }

    thumb.addEventListener('mousedown',  onStart);
    thumb.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('mousemove',  onMove);
    document.addEventListener('touchmove',  onMove, { passive: false });
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchend',  onEnd);
  }

  // ==================== FULLSCREEN CHART ====================
  function initFullscreenChart() {
    const overlay     = document.getElementById('chart-overlay');
    const closeBtn    = document.getElementById('close-fullscreen');
    const fullBtn     = document.getElementById('fullscreen-btn');
    const fsCanvas    = document.getElementById('trading-chart-fs');
    let fsChart       = null;

    if (fullBtn) {
      fullBtn.addEventListener('click', () => {
        overlay.classList.add('open');

        // Try to lock landscape on mobile
        try {
          screen.orientation && screen.orientation.lock('landscape').catch(() => {});
        } catch (_) {}

        // Lazily create a second chart instance for the overlay
        if (!fsChart) fsChart = new window.TradingChart('trading-chart-fs');
        // Sync data from main chart if possible
        if (chart && chart._lastData) fsChart.updateData(chart._lastData.spots, chart._lastData.macd, allOrders);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        overlay.classList.remove('open');
        try { screen.orientation && screen.orientation.unlock(); } catch (_) {}
      });
    }
  }

  // ==================== LOG FILTER CHIPS ====================
  function initLogFilterChips() {
    const chips = document.querySelectorAll('.log-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeLogFilter = chip.dataset.filter;
        renderLogs();
      });
    });
  }

  // ==================== DYNAMIC ISLAND ====================
  function initIsland() {
    const island   = document.getElementById('position-island');
    const expanded = document.getElementById('island-expanded');
    if (!island) return;

    island.addEventListener('click', () => {
      expanded.classList.toggle('open');
      const arrow = island.querySelector('span:last-child');
      if (arrow) arrow.textContent = expanded.classList.contains('open') ? '▲ tap to collapse' : '▼ tap to expand';
    });
  }

  function updateIsland(position, pnl) {
    const island    = document.getElementById('position-island');
    const islandText = document.getElementById('island-text');
    const islandSym = document.getElementById('island-symbol');
    const islandEntry = document.getElementById('island-entry');
    const islandPnl = document.getElementById('island-pnl');

    if (!island || !position) return;

    island.classList.add('active');

    const pnlStr = pnl !== null
      ? `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`
      : '₹--';

    if (islandText)  islandText.textContent  = `${position.optionType} ${position.strikePrice} | ${pnlStr}`;
    if (islandSym)   islandSym.textContent   = position.tradingSymbol;
    if (islandEntry) islandEntry.textContent = `₹${position.entryPrice.toFixed(2)}`;
    if (islandPnl)   animateCurrency(islandPnl, pnl || 0, true);
  }

  function clearIsland() {
    const island   = document.getElementById('position-island');
    const expanded = document.getElementById('island-expanded');
    if (island) island.classList.remove('active');
    if (expanded) expanded.classList.remove('open');
  }

  // ==================== HEARTBEAT ====================
  function pulseHeartbeat() {
    const dot = document.getElementById('heartbeat-dot');
    if (!dot) return;

    // Reset timer
    clearTimeout(heartbeatTimer);
    dot.className = 'alive';

    // Remove animation class so it re-triggers next pulse
    setTimeout(() => dot.classList.remove('alive'), 1200);

    // If no pulse for 6s, go red
    heartbeatTimer = setTimeout(() => {
      dot.className = 'dead';
    }, HEARTBEAT_TIMEOUT);
  }

  // ==================== TOAST ====================
  function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (isError) {
      toast.style.borderLeftColor = 'var(--accent-sell)';
      if (typeof playTone === 'function') playTone('error');
    }
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 4200);
  }

  // ==================== HAPTIC ====================
  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {}
  }

  // ==================== UTILS ====================
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatIST(dbDateString) {
    if (!dbDateString) return '--:--:--';
    let s = dbDateString;
    if (!s.includes('Z') && !s.includes('+')) s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return dbDateString;
    return d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }  // ==================== SETTINGS MODAL ====================
  function initSettingsModal() {
    const settingsBtn = document.getElementById('settings-btn');
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    
    if (!settingsBtn || !modal || !closeBtn || !saveBtn) return;

    settingsBtn.addEventListener('click', async () => {
      // Fetch current config
      try {
        const res = await fetch('/api/config');
        const { data } = await res.json();
        if (data) {
          document.getElementById('setting-max-risk').value = data['max_risk_pct'] || 100;
          document.getElementById('setting-max-slippage').value = data['max_slippage_pct'] || 1;
          document.getElementById('setting-paper-mode').checked = data['paper_mode'] === 'true';
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      modal.style.display = 'flex';
    });

    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    saveBtn.addEventListener('click', async () => {
      const payload = {
        max_risk_pct: document.getElementById('setting-max-risk').value,
        max_slippage_pct: document.getElementById('setting-max-slippage').value,
        paper_mode: document.getElementById('setting-paper-mode').checked ? 'true' : 'false'
      };

      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Settings saved successfully');
        modal.style.display = 'none';
      } catch (e) {
        showToast('Failed to save settings', true);
      }
      saveBtn.textContent = originalText;
    });
  }

})();
