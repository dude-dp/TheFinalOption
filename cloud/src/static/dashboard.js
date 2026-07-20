// ============================================
// Dashboard Client-Side Logic — PWA Edition
// All 10 mobile improvements implemented
// ============================================

(function () {
  'use strict';

  // --- ADVANCED LOGGING SYSTEM ---
  class SystemLogger {
      constructor() {
          this.container = document.getElementById('system-logs');
          this.currentFilter = 'all';
          this.setupTabs();
          this.log('Terminal session initialized.', 'system', 'cloud');
      }

      setupTabs() {
          const tabs = document.querySelectorAll('.log-tab');
          tabs.forEach(tab => {
              tab.addEventListener('click', (e) => {
                  // UI Update
                  tabs.forEach(t => t.classList.remove('active'));
                  e.target.classList.add('active');
                  
                  // Filter Logic
                  this.currentFilter = e.target.getAttribute('data-filter');
                  this.applyFilter();
              });
          });
      }

      applyFilter() {
          if (!this.container) return;
          const lines = this.container.querySelectorAll('.log-line');
          lines.forEach(line => {
              if (this.currentFilter === 'all') {
                  line.style.display = 'flex';
              } else {
                  const type = line.getAttribute('data-type');
                  const source = line.getAttribute('data-source');
                  
                  if (
                      (this.currentFilter === 'trade' && type === 'trade') ||
                      (this.currentFilter === 'error' && type === 'error') ||
                      (this.currentFilter === 'ec2' && source === 'ec2')
                  ) {
                      line.style.display = 'flex';
                  } else {
                      line.style.display = 'none';
                  }
              }
          });
      }

      /**
       * @param {string} message 
       * @param {string} type - 'info' | 'error' | 'trade' | 'system'
       * @param {string} source - 'cloud' | 'ec2' | 'broker'
       */
      log(message, type = 'info', source = 'cloud') {
          if (!this.container) return;

          // Map legacy types to new types
          if (type === 'success') type = 'trade';
          if (type === 'warning') type = 'info';

          const colors = {
              info: 'var(--text-primary)',
              trade: 'var(--accent-success)',
              error: 'var(--accent-danger)',
              system: 'var(--text-secondary)'
          };

          const tagColors = {
              cloud: 'rgba(255,255,255,0.1)',
              ec2: 'rgba(139, 92, 246, 0.2)', // Purple for daemon
              broker: 'rgba(59, 130, 246, 0.2)'
          };

          const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric", fractionalSecondDigits: 3 });
          
          const logHTML = `
              <div class="log-line" data-type="${type}" data-source="${source}">
                  <span class="log-time">[${timestamp}]</span>
                  <span class="log-tag mono" style="background: ${tagColors[source] || tagColors.cloud}; color: ${source === 'ec2' ? 'var(--accent-system)' : 'inherit'}">${(source || 'cloud').toUpperCase()}</span>
                  <span class="log-msg" style="color: ${colors[type] || colors.info}">${message}</span>
              </div>
          `;

          this.container.insertAdjacentHTML('afterbegin', logHTML);
          this.applyFilter(); // Re-apply filter so incoming logs respect current tab
      }
  }

  const terminal = new SystemLogger();

  window.addLog = function(message, type = 'info') {
      terminal.log(message, type, 'cloud');
  };

  window.updateBotIntelligence = function(payload) {
      if (!payload) return;
      
      if (payload.regime) {
          const regimeEl = document.getElementById('intel-regime');
          if (regimeEl) {
              regimeEl.innerText = payload.regime;
              regimeEl.style.color = payload.regime.includes('Bullish') ? 'var(--accent-success)' : 
                                     payload.regime.includes('Bearish') ? 'var(--accent-danger)' : 'var(--accent-warning)';
          }
      }

      if (payload.confluenceScore !== undefined) {
          const txt = document.getElementById('intel-score-txt');
          if (txt) txt.innerText = `${payload.confluenceScore}%`;
          
          const fill = document.getElementById('intel-score-fill');
          if (fill) {
              fill.style.width = `${payload.confluenceScore}%`;
              fill.style.background = payload.confluenceScore > 75 ? 'var(--accent-success)' : 
                                      payload.confluenceScore > 40 ? 'var(--accent-warning)' : 'var(--accent-danger)';
          }
      }

      if (payload.activeTask) {
          const taskEl = document.getElementById('intel-task');
          if (taskEl) taskEl.innerText = payload.activeTask;
      }
  };

  const POLL_INTERVAL = 3000;
  const HEARTBEAT_TIMEOUT = 6000;

  // ==================== SVG ICON CONSTANTS ====================
  const ICON_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z"/></svg>`;
  const ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z"/></svg>`;
  const ICON_ALERT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg>`;
  const ICON_WARN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12v-4"/><path d="M12 16v.01"/><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z"/></svg>`;
  const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 12l5 5l10 -10"/></svg>`;
  const EMPTY_SVG = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3;margin-bottom:10px;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path d="M4 13h3l3 3h4l3 -3h3" /></svg><p style="margin:0;font-size:0.9rem;">Nothing to see here yet.</p></div>`;

  let tvChart = null;
  let candleSeries = null;
  let macdSeries = null;
  let signalSeries = null;
  let histogramSeries = null;
  let currentStatus = 'STOPPED';

  let hardSLLine = null;
  let trailingSLLine = null;
  let isDraggingLine = null; // 'HARD' or 'TRAILING'
  let currentHardSLPrice = 0;
  let currentTrailingSLPrice = 0;

  let celebratedTradeId = null;

  let isVoiceEnabled = false;
  let lastSpokenAlertId = null;
  let currentMode = 'PAPER';

  function speakMarketAlert(text) {
    if (!isVoiceEnabled || !window.speechSynthesis) return;

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1; 
    utterance.pitch = 1.0; 
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.lang === 'en-US');
    if (preferredVoice) utterance.voice = preferredVoice;

    window.speechSynthesis.speak(utterance);
  }

  function fireProfitConfetti(profitPct) {
    const duration = 3000;
    const end = Date.now() + duration;
    const colors = ['#00e676', '#ffea00', '#ffffff'];

    (function frame() {
      window.confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: colors
      });
      window.confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: colors
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
    
    window.addLog(`🎉 MASSIVE WIN: +${profitPct.toFixed(2)}% ROI 🎉`, 'success');
  }

  function setupDragAndDropSL(container) {
    // MOUSE DOWN: Detect if cursor is near a Stop Loss line
    container.addEventListener('mousedown', (e) => {
      if (!candleSeries || (!hardSLLine && !trailingSLLine)) return;
      
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      
      const hardSLY = currentHardSLPrice ? candleSeries.priceToCoordinate(currentHardSLPrice) : -999;
      const trailingSLY = currentTrailingSLPrice ? candleSeries.priceToCoordinate(currentTrailingSLPrice) : -999;

      // 15-pixel grab radius
      if (Math.abs(y - hardSLY) < 15) {
        isDraggingLine = 'HARD';
        tvChart.applyOptions({ handleScroll: false, handleScale: false }); // Lock chart panning
        hardSLLine.applyOptions({ color: '#ffea00', lineStyle: 0 }); // Turn solid yellow while dragging
      } else if (Math.abs(y - trailingSLY) < 15) {
        isDraggingLine = 'TRAILING';
        tvChart.applyOptions({ handleScroll: false, handleScale: false });
        trailingSLLine.applyOptions({ color: '#ffea00', lineStyle: 0 });
      }
    });

    // MOUSE MOVE: Move the line with the cursor
    container.addEventListener('mousemove', (e) => {
      if (!isDraggingLine) return;
      
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const newPrice = candleSeries.coordinateToPrice(y);

      if (isDraggingLine === 'HARD' && hardSLLine) {
        currentHardSLPrice = newPrice;
        hardSLLine.applyOptions({ price: newPrice });
      } else if (isDraggingLine === 'TRAILING' && trailingSLLine) {
        currentTrailingSLPrice = newPrice;
        trailingSLLine.applyOptions({ price: newPrice });
      }
    });

    // MOUSE UP: Drop the line and fire the API request
    container.addEventListener('mouseup', async () => {
      if (isDraggingLine) {
        const finalPrice = isDraggingLine === 'HARD' ? currentHardSLPrice : currentTrailingSLPrice;
        const typeStr = isDraggingLine;
        
        // Reset State
        isDraggingLine = null;
        tvChart.applyOptions({ handleScroll: true, handleScale: true }); // Unlock panning
        
        // Revert styles
        if (hardSLLine) hardSLLine.applyOptions({ color: '#ff1744', lineStyle: 2 });
        if (trailingSLLine) trailingSLLine.applyOptions({ color: '#ff9800', lineStyle: 2 });

        try {
          await fetch('/api/position/sl-override', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: typeStr, price: finalPrice })
          });
          
          window.addLog(`Successfully locked new ${typeStr} Stop Loss at ₹${finalPrice.toFixed(2)}`, 'success');
        } catch (err) {
          console.error('Failed to save manual SL:', err);
        }
      }
    });
  }

  function initTradingViewChart() {
    const container = document.getElementById('tv-chart-container');
    if (!container) return;

    // 1. Initialize the Chart with a custom deep-dark aesthetic
    tvChart = window.LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: 'transparent' }, // Transparent background
        textColor: '#D9D9D9',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: 'rgba(224, 227, 235, 0.4)',
          style: window.LightweightCharts.LineStyle.Dashed,
        },
        horzLine: {
          width: 1,
          color: 'rgba(224, 227, 235, 0.4)',
          style: window.LightweightCharts.LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const date = new Date(time * 1000);
          const timeStr = date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
          const dateStr = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' });
          // If it's a new day/month, show date instead of time, otherwise time.
          return (tickMarkType === 2 || tickMarkType === 3) ? dateStr : timeStr;
        }
      },
      localization: {
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });

    // 2. Create the Candlestick Series
    console.log('TV Chart Object:', tvChart);
    candleSeries = tvChart.addCandlestickSeries({
      upColor: '#00e676',       // Institutional Green
      downColor: '#ff1744',     // Deep Red
      borderVisible: false,
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
    });

    macdSeries = tvChart.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceScaleId: 'left', // Render on left scale to avoid squishing the price candles
    });

    signalSeries = tvChart.addLineSeries({
      color: '#FF6D00',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceScaleId: 'left',
    });

    histogramSeries = tvChart.addHistogramSeries({
      color: '#26a69a',
      priceScaleId: 'left',
    });

    tvChart.priceScale('left').applyOptions({
      visible: false, // Hidden so it doesn't take up empty canvas space on the left, but still scales MACD independently
      scaleMargins: {
        top: 0.8, // MACD occupies the bottom 20% of the chart
        bottom: 0,
      },
    });

    tvChart.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.05,
        bottom: 0.25, // Candles occupy the top 75% of the chart, leaving space for MACD
      },
    });

    // 3. Make the chart responsive to window resizing
    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) { return; }
      const newRect = entries[0].contentRect;
      tvChart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(container);

    setupDragAndDropSL(container);
  }

  function loadHistoricalCandles(historicalData, macdData, signalData, histogramData) {
    if (candleSeries && historicalData) candleSeries.setData(historicalData);
    if (macdSeries && macdData) macdSeries.setData(macdData);
    if (signalSeries && signalData) signalSeries.setData(signalData);
    if (histogramSeries && histogramData) histogramSeries.setData(histogramData);
  }

  function updateLiveChart(latestTick) {
    if (!candleSeries || !latestTick) return;
    
    const tvTick = {
      time: Math.floor(new Date(latestTick.timestamp).getTime() / 1000), // UNIX seconds
      open: latestTick.open,
      high: latestTick.high,
      low: latestTick.low,
      close: latestTick.ltp // The current live price
    };

    candleSeries.update(tvTick);
    
    // Also update MACD if present
    if (macdSeries && latestTick.macd_line !== undefined) {
      macdSeries.update({
        time: tvTick.time,
        value: latestTick.macd_line
      });
    }
  }
  let lastActivePosition = null;
  let lastActiveHedgePosition = null;
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

  // ==================== API FUEL GAUGE ====================
  function updateFuelGauge(metrics, daemonAlive) {
    const fuelFill = document.getElementById('api-fuel-fill');
    const fuelText = document.getElementById('api-fuel-text');
    if (!fuelFill || !fuelText) return;

    if (!daemonAlive) {
      fuelFill.style.width = '0%';
      fuelFill.style.backgroundColor = 'var(--text-muted)';
      fuelText.textContent = 'Offline';
      fuelText.style.color = 'var(--text-muted)';
      return;
    }

    const minRate = metrics.reqPerMinute || 0;
    const maxMinuteLimit = 200; // API Rate Limit threshold
    const percent = Math.min((minRate / maxMinuteLimit) * 100, 100);

    fuelFill.style.width = `${percent}%`;

    // Dynamic coloring based on thresholds
    if (minRate >= 160) {
      fuelFill.style.backgroundColor = 'var(--accent-sell)';
      fuelText.style.color = 'var(--accent-sell)';
    } else if (minRate >= 100) {
      fuelFill.style.backgroundColor = 'var(--accent-orange)';
      fuelText.style.color = 'var(--accent-orange)';
    } else {
      fuelFill.style.backgroundColor = 'var(--accent-buy)';
      fuelText.style.color = 'var(--text-primary)';
    }

    fuelText.textContent = `${minRate}/${maxMinuteLimit}`;
  }

  // ==================== INIT ====================
  document.addEventListener('DOMContentLoaded', () => {
    initTradingViewChart();
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
        fetchQuantMetrics(),
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

    // Gamification Confetti Trigger
    if (data.lastProfitableTradeId && data.lastProfitableTradeId !== celebratedTradeId) {
      if (celebratedTradeId !== null) {
        fireProfitConfetti(data.lastProfitPct || 0);
      }
      celebratedTradeId = data.lastProfitableTradeId;
    }

    // Voice Alert Trigger
    if (data.lastVoiceAlertId && data.lastVoiceAlertId !== lastSpokenAlertId) {
      if (lastSpokenAlertId !== null) {
        speakMarketAlert(data.lastVoiceAlert);
      }
      lastSpokenAlertId = data.lastVoiceAlertId;
    }

    currentStatus = data.status;
    currentMode = data.tradingMode || 'PAPER';

    // Update Mode indicator/badge in UI
    const modeText = document.getElementById('mode-text');
    const modeIcon = document.getElementById('mode-icon');
    const positionModeBadge = document.getElementById('position-mode-badge');
    
    if (modeText) modeText.textContent = `Mode: ${currentMode}`;
    if (modeIcon) modeIcon.textContent = currentMode === 'LIVE' ? '💰' : '🧪';
    if (positionModeBadge) {
      positionModeBadge.textContent = currentMode;
      if (currentMode === 'LIVE') {
        positionModeBadge.style.color = 'var(--accent-buy)';
        positionModeBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      } else {
        positionModeBadge.style.color = 'var(--text-secondary)';
        positionModeBadge.style.borderColor = 'var(--border-color)';
      }
    }

    // Status badge text & Radar ping
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    if (statusText) statusText.textContent = data.status;
    if (statusDot) {
      if (data.status === 'RUNNING') {
        statusDot.style.background = 'var(--accent-buy)';
        statusDot.style.boxShadow = '0 0 8px var(--accent-buy)';
      } else if (data.status === 'EMERGENCY_HALT') {
        statusDot.style.background = 'var(--accent-sell)';
        statusDot.style.boxShadow = '0 0 8px var(--accent-sell)';
      } else {
        statusDot.style.background = 'var(--text-muted)';
        statusDot.style.boxShadow = 'none';
      }
    }

    if (data.botIntelligence && window.updateBotIntelligence) {
      window.updateBotIntelligence(data.botIntelligence);
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

    // Live rate metrics from daemon
    updateFuelGauge(data.daemonMetrics, data.daemonAlive);

    // 🟢 Update Live Candle in Chart
    if (data.latestTick) {
      updateLiveChart(data.latestTick);
    }

    // Update Quant Analytics indicators
    if (data.indicators) {
      const pcrEl = document.getElementById('metric-pcr');
      const macdEl = document.getElementById('metric-macd');
      const atrEl = document.getElementById('metric-atr');
      const adxEl = document.getElementById('metric-adx');

      if (pcrEl) {
        pcrEl.innerText = data.indicators.pcr !== undefined && data.indicators.pcr !== null ? data.indicators.pcr.toFixed(2) : '--';
      }
      if (macdEl) {
        const hist = data.indicators.macdHist || 0;
        macdEl.innerText = hist.toFixed(2);
        if (hist >= 0) {
          macdEl.className = 'metric-value text-green';
        } else {
          macdEl.className = 'metric-value text-red';
        }
      }
      if (atrEl) {
        atrEl.innerText = data.indicators.atr !== undefined && data.indicators.atr !== null ? data.indicators.atr.toFixed(2) : '--';
      }
      if (adxEl) {
        adxEl.innerText = data.indicators.adx !== undefined && data.indicators.adx !== null ? data.indicators.adx.toFixed(2) : '--';
      }
    }

    // Active position tracker
    const noPosEl = document.getElementById('no-position');
    const activePosEl = document.getElementById('active-position');

    if (noPosEl && activePosEl) {
      const posBento = activePosEl.closest('.bento-card');
      const p1 = data.activePosition;
      const p2 = data.activeHedgePosition;
      const hasPos = !!(p1 || p2);

      if (hasPos) {
        noPosEl.style.display = 'none';
        activePosEl.style.display = 'flex';
        activePosEl.style.flexDirection = 'column';
        activePosEl.style.gap = '8px';
        if (posBento) posBento.classList.add('live-trade');

        let totalPnL = 0;
        if (p1) totalPnL += p1.unrealizedPnL || 0;
        if (p2) totalPnL += p2.unrealizedPnL || 0;

        let legsHtml = `
          <div class="metric-box" id="pnl-card" style="padding: 12px 16px;">
            <span class="metric-label" style="font-size: 0.75rem;">Combined Unrealized PnL</span>
            <span id="pos-pnl" class="metric-value" style="font-size: 1.3rem;">₹${totalPnL.toFixed(2)}</span>
          </div>
        `;

        const legs = [p1, p2].filter(Boolean);
        for (const leg of legs) {
          const legPnl = leg.unrealizedPnL || 0;
          const pnlColor = legPnl >= 0 ? 'var(--accent-buy)' : 'var(--accent-sell)';
          const directionColor = leg.optionType === 'CE' ? 'var(--accent-buy)' : 'var(--accent-sell)';

          legsHtml += `
            <div class="metric-box" style="padding: 10px 12px; gap: 4px; background: rgba(0,0,0,0.3);">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; font-size:0.85rem; color:${directionColor}; font-family:var(--font-mono);">${leg.tradingSymbol}</span>
                <span style="font-weight:700; font-size:0.85rem; color:${pnlColor}; font-family:var(--font-mono);">${legPnl >= 0 ? '+' : ''}₹${legPnl.toFixed(2)}</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted);">
                <span>Entry: ₹${leg.entryPrice.toFixed(2)}</span>
                <span>LTP: ₹${(leg.ltp || leg.entryPrice).toFixed(2)}</span>
              </div>
              <div style="font-size:0.7rem; color:var(--text-muted); display:flex; justify-content:space-between;">
                <span>Lots: ${leg.lots}</span>
                <span>Qty: ${leg.quantity}</span>
              </div>
            </div>
          `;
        }

        activePosEl.innerHTML = legsHtml;

        // PnL glow and Aurora Background
        const dynamicPnlCard = document.getElementById('pnl-card');
        if (dynamicPnlCard) {
          dynamicPnlCard.classList.remove('glow-green', 'glow-red');
          if (totalPnL > 0) dynamicPnlCard.classList.add('glow-green');
          if (totalPnL < 0) dynamicPnlCard.classList.add('glow-red');
        }
        document.body.classList.remove('market-up', 'market-down');
        if (totalPnL > 0) document.body.classList.add('market-up');
        if (totalPnL < 0) document.body.classList.add('market-down');

        // Update Dynamic Island
        const primaryLeg = p1 || p2;
        updateIsland(primaryLeg, totalPnL, p1 && p2 ? 'STRADDLE' : null);

        // Toast on new autopilot entry
        const wasEmpty = !lastActivePosition && !lastActiveHedgePosition;
        if (wasEmpty) {
          if (p1 && p2) {
            showToast(`Straddle entered: CE & PE @ NIFTY`);
          } else {
            const entered = p1 || p2;
            showToast(`Entry: ${entered.tradingSymbol} × ${entered.lots} lots @ ₹${entered.entryPrice.toFixed(2)}`);
          }
          vibrate([50, 100, 50]);
          playTone('entry');
        }
      } else {
        noPosEl.style.display = 'flex';
        activePosEl.style.display = 'none';
        activePosEl.innerHTML = '';
        if (posBento) posBento.classList.remove('live-trade');
        document.body.classList.remove('market-up', 'market-down');
        clearIsland();

        // Toast on position close
        const wasActive = !!(lastActivePosition || lastActiveHedgePosition);
        if (wasActive) {
          showToast('Positions Closed — Check the Ledger for PnL.');
          vibrate([100, 50, 100]);
          playTone('exit');
        }
      }
    }

    lastActivePosition = data.activePosition;
    lastActiveHedgePosition = data.activeHedgePosition;

    if (data.activePosition && candleSeries) {
      const pos = data.activePosition;
      const calculatedHardSL = pos.entryPrice * 0.94; // Fallback if no ATR is present
      const calculatedTSL = (pos.highestPrice || pos.entryPrice) * 0.96; 
      
      const targetHardSL = pos.manualHardSL || calculatedHardSL;
      const targetTSL = pos.manualTrailingSL || calculatedTSL;

      if (!isDraggingLine) {
        currentHardSLPrice = targetHardSL;
        currentTrailingSLPrice = targetTSL;

        if (hardSLLine) {
          hardSLLine.applyOptions({ price: targetHardSL });
        } else {
          hardSLLine = candleSeries.createPriceLine({
            price: targetHardSL,
            color: '#ff1744',
            lineWidth: 2,
            lineStyle: window.LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'HARD SL',
          });
        }

        if (trailingSLLine) {
          trailingSLLine.applyOptions({ price: targetTSL });
        } else {
          trailingSLLine = candleSeries.createPriceLine({
            price: targetTSL,
            color: '#ff9800', 
            lineWidth: 2,
            lineStyle: window.LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TSL',
          });
        }
      }
    } else {
      if (hardSLLine && candleSeries) { candleSeries.removePriceLine(hardSLLine); hardSLLine = null; }
      if (trailingSLLine && candleSeries) { candleSeries.removePriceLine(trailingSLLine); trailingSLLine = null; }
    }
  }

  // ==================== CHART DATA ====================
  function renderTVMarkers() {
    if (!candleSeries || !allOrders) return;
    
    const markers = [];
    allOrders.forEach(order => {
      if (order.order_status === 'FILLED' || order.order_status === 'COMPLETED') {
        const timeField = order.timestamp || order.created_at || order.createdAt;
        if (!timeField) return;
        
        markers.push({
          time: Math.floor(new Date(timeField).getTime() / 1000),
          position: order.transaction_type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: order.transaction_type === 'BUY' ? '#2196F3' : '#ff1744',
          shape: order.transaction_type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${order.transaction_type} ${order.option_type || ''} @ ${order.order_price || ''}`
        });
      }
    });

    // Markers must be sorted by time for TradingView
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
  }

  async function fetchChartData() {
    const res = await fetch('/api/chart-data');
    const data = await res.json();
    
    if (data.spots && data.spots.length > 0) {
      const historicalData = data.spots.map(spot => {
        let uTime = spot.time;
        if (!uTime && spot.timestamp) {
          const parsed = new Date(spot.timestamp).getTime();
          if (!isNaN(parsed)) uTime = Math.floor(parsed / 1000);
        }
        return {
          time: uTime,
          open: spot.open,
          high: spot.high,
          low: spot.low,
          close: spot.close
        };
      });
      // Sort strictly ascending
      historicalData.sort((a, b) => a.time - b.time);
      
      // Calculate full MACD locally for the chart
      const closePrices = historicalData.map(d => d.close);
      
      function calcEMA(data, period) {
        const k = 2 / (period + 1);
        let ema = data[0];
        const res = [ema];
        for (let i = 1; i < data.length; i++) {
          ema = (data[i] - ema) * k + ema;
          res.push(ema);
        }
        return res;
      }
      
      const fastEma = calcEMA(closePrices, 12);
      const slowEma = calcEMA(closePrices, 26);
      const macdValues = [];
      for(let i=0; i<closePrices.length; i++) macdValues.push(fastEma[i] - slowEma[i]);
      const signalValues = calcEMA(macdValues, 9);
      
      const macdData = [];
      const signalData = [];
      const histogramData = [];
      
      for(let i=0; i<historicalData.length; i++) {
        const time = historicalData[i].time;
        const hist = macdValues[i] - signalValues[i];
        macdData.push({ time, value: macdValues[i] });
        signalData.push({ time, value: signalValues[i] });
        histogramData.push({
          time,
          value: hist,
          color: hist >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(255, 82, 82, 0.5)'
        });
      }

      loadHistoricalCandles(historicalData, macdData, signalData, histogramData);
      renderTVMarkers();
    }
  }

  // ==================== TELEMETRY ====================
  let logAutoScroll = true;
  let logSearchTerm = '';

  async function fetchTelemetry() {
    const res = await fetch('/api/telemetry?limit=100');
    const data = await res.json();
    if (!data.data) return;

    allLogEntries = data.data;
    renderLogs();
  }

  function classifyLog(msg) {
    if (!msg || msg.trim().length === 0) return { level: 'TICK', label: 'TICK' };
    if (msg.match(/ERROR|HALT|FAILED|REJECTED/i)) return { level: 'ERR', label: 'ERR' };
    if (msg.match(/WARN|SKIP|INSUFFICIENT/i)) return { level: 'WARN', label: 'WARN' };
    if (msg.match(/SIGNAL|NEW ENTRY|SQUARE-OFF|FILLED/i)) return { level: 'TRD', label: 'TRD' };
    if (msg.match(/AUTO_SQUAREOFF|DRAWDOWN|DAEMON|HEARTBEAT|WARMUP/i)) return { level: 'SYS', label: 'SYS' };
    return { level: 'INFO', label: 'INFO' };
  }

  function renderLogs() {
    const consoleEl = document.getElementById('system-logs');
    const badge = document.getElementById('log-count-badge');
    if (!consoleEl) return;

    // We will show all entries, even MACD ticks, so the log feels "alive"
    let meaningful = allLogEntries;

    // Apply category filter
    const filtered = meaningful.filter(entry => {
      if (activeLogFilter === 'all') return true;
      const { level } = classifyLog(entry.log_message);
      if (activeLogFilter === 'trade') return level === 'TRD';
      if (activeLogFilter === 'warn') return level === 'WARN';
      if (activeLogFilter === 'error') return level === 'ERR';
      if (activeLogFilter === 'system') return level === 'SYS' || level === 'TICK';
      return true;
    });

    // Apply search filter
    const searched = logSearchTerm
      ? filtered.filter(e => (e.log_message || '').toLowerCase().includes(logSearchTerm.toLowerCase()))
      : filtered;

    // Update badge count
    if (badge) badge.textContent = searched.length;

    // Empty state
    if (searched.length === 0) {
      consoleEl.innerHTML = `<div class="log-empty">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5l-5 5"/><path d="M12 19l7 0"/></svg>
        <p>${logSearchTerm ? 'No logs match your search.' : 'Waiting for execution data...'}</p>
      </div>`;
      return;
    }

    consoleEl.innerHTML = searched.map(entry => {
      const ts = formatIST(entry.timestamp);
      let msg = entry.log_message || '';

      if (!msg || msg.trim().length === 0) {
        msg = `Heartbeat | Spot: ${entry.nifty_spot?.toFixed(2)} | MACD: ${entry.macd_line?.toFixed(2)}`;
      }

      const { level, label } = classifyLog(entry.log_message);

      // Highlight search term in message
      let displayMsg = escapeHtml(msg);
      if (logSearchTerm) {
        const regex = new RegExp('(' + escapeHtml(logSearchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        displayMsg = displayMsg.replace(regex, '<span class="log-highlight">$1</span>');
      }

      const colors = {
        'INFO': 'var(--text-primary)',
        'TRD': 'var(--accent-success)',
        'ERR': 'var(--accent-danger)',
        'WARN': 'var(--accent-info)',
        'SYS': 'var(--accent-info)',
        'TICK': 'var(--text-secondary)'
      };

      return `<div class="log-line">
        <span class="log-time">[${ts}]</span>
        <span class="log-msg" style="color: ${colors[level] || colors['INFO']}"><span style="color: var(--text-secondary);">[${label}]</span> ${displayMsg}</span>
      </div>`;
    }).join('');

    if (logAutoScroll) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  // ==================== ORDERS ====================
  async function fetchOrders() {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('ledger-body');
    if (!tbody || !data.data) return;

    allOrders = data.data; // Store for chart execution flags
    renderTVMarkers();

    if (allOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">${EMPTY_SVG}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.data.map(o => {
      const statusClass = o.order_status === 'FILLED' ? 'text-green' : o.order_status === 'REJECTED' ? 'text-red' : '';
      const time = formatIST(o.created_at);
      const pnl = o.pnl || 0;
      const pnlClass = pnl > 0 ? 'text-green' : pnl < 0 ? 'text-red' : '';
      const typeColor = o.transaction_type === 'BUY' ? 'var(--accent-buy)' : 'var(--accent-sell)';

      const tooltipAttr = (o.order_status === 'REJECTED' && o.status_message)
        ? `data-tooltip="${escapeHtml(o.status_message)}"`
        : '';

      let tagsHtml = '';
      if (o.tags) {
        tagsHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">` + 
          o.tags.split(',').map(tag => `<span style="font-size:10px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color); padding:1px 4px; border-radius:4px; color:var(--text-secondary); font-family:var(--font-sans);">${tag.trim()}</span>`).join('') + 
          `</div>`;
      }

      return `<tr onclick="openJournalModal('${o.correlation_id}')" style="cursor:pointer;">
        <td data-label="Time"     style="font-family:var(--font-mono);color:var(--text-muted);">${time}</td>
        <td data-label="Contract" style="font-weight:600;">${o.trading_symbol || '--'}${tagsHtml}</td>
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

    // 4. Voice Telemetry Toggle
    const voiceBtn = document.getElementById('voice-toggle');
    const voiceIcon = document.getElementById('voice-icon');
    const voiceText = document.getElementById('voice-text');

    if (voiceBtn) {
      voiceBtn.addEventListener('click', () => {
        isVoiceEnabled = !isVoiceEnabled;
        if (isVoiceEnabled) {
          if (voiceIcon) voiceIcon.innerText = '🔊';
          if (voiceText) {
            voiceText.innerText = 'Voice: On';
            voiceText.style.color = 'var(--accent-success)';
          }
          voiceBtn.style.borderColor = 'var(--accent-success)';
          speakMarketAlert("Audio telemetry armed.");
        } else {
          if (voiceIcon) voiceIcon.innerText = '🔇';
          if (voiceText) {
            voiceText.innerText = 'Voice: Off';
            voiceText.style.color = '';
          }
          voiceBtn.style.borderColor = '';
          if (window.speechSynthesis) window.speechSynthesis.cancel();
        }
      });
    }

    // 5. Trading Mode Toggle
    const modeBtn = document.getElementById('mode-toggle');
    if (modeBtn) {
      modeBtn.addEventListener('click', async () => {
        const nextMode = currentMode === 'LIVE' ? 'PAPER' : 'LIVE';
        if (!confirm(`Switch to ${nextMode} trading mode?\n(Live mode will route orders to real account, Paper mode executes virtual orders)`)) return;

        try {
          const res = await fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'SET_MODE', mode: nextMode })
          });
          const data = await res.json();
          if (data.success) {
            currentMode = nextMode;
            showToast(`Switched to ${nextMode} trading mode.`);
            fetchStatus();
          } else {
            showToast('Failed to switch trading mode.');
          }
        } catch (e) {
          showToast('Network error toggling mode.');
        }
      });
    }
  }

  // ==================== QUANT RATIOS ====================
  async function fetchQuantMetrics() {
    try {
      const res = await fetch('/api/analytics/ratios');
      const data = await res.json();
      
      updateMetricUI('sharpe', parseFloat(data.sharpe), { poor: 1.0, good: 1.5, elite: 2.0 });
      updateMetricUI('sortino', parseFloat(data.sortino), { poor: 1.5, good: 2.0, elite: 3.0 });
      updateMetricUI('calmar', parseFloat(data.calmar), { poor: 1.5, good: 3.0, elite: 5.0 });
      
    } catch (err) {
      console.error("Failed to fetch quant metrics", err);
    }
  }

  function updateMetricUI(id, value, thresholds) {
    const valueEl = document.getElementById(`metric-${id}`);
    const badgeEl = document.getElementById(`badge-${id}`);
    if (!valueEl || !badgeEl) return;

    valueEl.innerText = value.toFixed(2);

    if (value >= thresholds.elite) {
      badgeEl.innerText = 'ELITE';
      badgeEl.style.background = 'rgba(168, 85, 247, 0.2)';
      badgeEl.style.color = 'rgb(216, 180, 254)';
    } else if (value >= thresholds.good) {
      badgeEl.innerText = 'GOOD';
      badgeEl.style.background = 'rgba(34, 197, 94, 0.2)';
      badgeEl.style.color = 'rgb(187, 247, 208)';
    } else if (value >= thresholds.poor) {
      badgeEl.innerText = 'ACCEPTABLE';
      badgeEl.style.background = 'rgba(234, 179, 8, 0.2)';
      badgeEl.style.color = 'rgb(254, 240, 138)';
    } else if (value > 0) {
      badgeEl.innerText = 'SUB-PAR';
      badgeEl.style.background = 'rgba(239, 68, 68, 0.2)';
      badgeEl.style.color = 'rgb(254, 202, 202)';
    } else {
      badgeEl.innerText = 'NEGATIVE';
      badgeEl.style.background = 'rgba(255, 255, 255, 0.05)';
      badgeEl.style.color = 'var(--text-secondary)';
    }
  }

  // ==================== MOBILE NAV ====================
  function initMobileNav() {
    const tabs = document.querySelectorAll('.nav-tab');
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
    const thumb = document.getElementById('slide-thumb');
    const fill = document.getElementById('slide-fill');
    if (!wrapper || !thumb) return;

    let startX = 0, isDragging = false;

    function onStart(e) {
      isDragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
    }

    function onMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const dx = clientX - startX;
      const maxTravel = wrapper.offsetWidth - thumb.offsetWidth - 8;
      const clamped = Math.max(0, Math.min(dx, maxTravel));
      const pct = clamped / maxTravel;

      thumb.style.left = `${4 + clamped}px`;
      fill.style.width = `${4 + clamped + thumb.offsetWidth / 2}px`;
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
      fill.style.transition = 'width 0.3s ease';
      thumb.style.left = '4px';
      fill.style.width = '0';
      thumb.style.opacity = '1';
      setTimeout(() => {
        thumb.style.transition = '';
        fill.style.transition = '';
      }, 300);
    }

    thumb.addEventListener('mousedown', onStart);
    thumb.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
  }

  // ==================== FULLSCREEN CHART ====================
  function initFullscreenChart() {
    const fullBtn = document.getElementById('fullscreen-btn');
    
    if (fullBtn) {
      fullBtn.addEventListener('click', () => {
        const container = document.getElementById('tv-chart-container');
        if (!container) return;
        
        if (container.requestFullscreen) {
          container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) { /* Safari */
          container.webkitRequestFullscreen();
        } else if (container.msRequestFullscreen) { /* IE11 */
          container.msRequestFullscreen();
        }

        // Try to lock landscape on mobile
        try {
          screen.orientation && screen.orientation.lock('landscape').catch(() => { });
        } catch (_) { }
      });
    }

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        try { screen.orientation && screen.orientation.unlock(); } catch (_) { }
      }
    });
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

    // Search input with debounce
    const searchInput = document.getElementById('log-search');
    if (searchInput) {
      let searchDebounce = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          logSearchTerm = searchInput.value.trim();
          renderLogs();
        }, 200);
      });
    }

    // Auto-scroll toggle
    const autoScrollBtn = document.getElementById('log-autoscroll-btn');
    if (autoScrollBtn) {
      autoScrollBtn.addEventListener('click', () => {
        logAutoScroll = !logAutoScroll;
        autoScrollBtn.classList.toggle('active', logAutoScroll);
      });
    }

    // Clear display
    const clearBtn = document.getElementById('log-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const consoleEl = document.getElementById('system-logs');
        if (consoleEl) {
          consoleEl.innerHTML = `<div class="log-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5l-5 5"/><path d="M12 19l7 0"/></svg>
            <p>Display cleared. New logs will appear on next poll.</p>
          </div>`;
        }
        const badge = document.getElementById('log-count-badge');
        if (badge) badge.textContent = '0';
      });
    }
  }

  // ==================== DYNAMIC ISLAND ====================
  function initIsland() {
    const island = document.getElementById('position-island');
    const expanded = document.getElementById('island-expanded');
    if (!island) return;

    island.addEventListener('click', () => {
      expanded.classList.toggle('open');
      const arrow = island.querySelector('span:last-child');
      if (arrow) arrow.textContent = expanded.classList.contains('open') ? '▲ tap to collapse' : '▼ tap to expand';
    });
  }

  function updateIsland(position, pnl, mode) {
    const island = document.getElementById('position-island');
    const islandText = document.getElementById('island-text');
    const islandSym = document.getElementById('island-symbol');
    const islandEntry = document.getElementById('island-entry');
    const islandPnl = document.getElementById('island-pnl');

    if (!island || !position) return;

    island.classList.add('active');

    const pnlStr = pnl !== null
      ? `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`
      : '₹--';

    if (islandText) {
      if (mode === 'STRADDLE') {
        islandText.textContent = `STRADDLE | ${pnlStr}`;
      } else {
        islandText.textContent = `${position.optionType} ${position.strikePrice} | ${pnlStr}`;
      }
    }
    if (islandSym) {
      islandSym.textContent = mode === 'STRADDLE' ? 'CE + PE Legs' : position.tradingSymbol;
    }
    if (islandEntry) {
      islandEntry.textContent = mode === 'STRADDLE' ? 'Multi-Entry' : `₹${position.entryPrice.toFixed(2)}`;
    }
    if (islandPnl) {
      animateCurrency(islandPnl, pnl || 0, true);
    }
  }

  function clearIsland() {
    const island = document.getElementById('position-island');
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
    } catch (_) { }
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
    const rollbackBtn = document.getElementById('rollback-btn');
    const rollbackSelect = document.getElementById('setting-rollback-select');

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

      // Fetch snapshots
      if (rollbackSelect) {
        rollbackSelect.innerHTML = '<option value="">Loading snapshots...</option>';
        try {
          const res = await fetch('/api/config/snapshots');
          const { data } = await res.json();
          if (data && data.length > 0) {
            rollbackSelect.innerHTML = data.map(s => 
              `<option value="${s.snapshot_date}">${s.snapshot_date}</option>`
            ).join('');
          } else {
            rollbackSelect.innerHTML = '<option value="">No snapshots found</option>';
          }
        } catch (e) {
          console.error('Failed to load snapshots:', e);
          rollbackSelect.innerHTML = '<option value="">Error loading snapshots</option>';
        }
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

    if (rollbackBtn && rollbackSelect) {
      rollbackBtn.addEventListener('click', async () => {
        const date = rollbackSelect.value;
        if (!date) {
          showToast('Please select a valid snapshot date', true);
          return;
        }

        if (!confirm(`Are you sure you want to rollback bot configuration to ${date}? This will overwrite active parameters.`)) return;

        const originalText = rollbackBtn.textContent;
        rollbackBtn.textContent = 'Restoring...';
        rollbackBtn.disabled = true;

        try {
          const res = await fetch('/api/config/rollback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date })
          });
          const result = await res.json();
          if (result.success) {
            showToast(`Config rolled back to ${date}`);
            modal.style.display = 'none';
          } else {
            showToast(result.error || 'Failed to rollback config', true);
          }
        } catch (e) {
          showToast('Failed to rollback config', true);
        } finally {
          rollbackBtn.textContent = originalText;
          rollbackBtn.disabled = false;
        }
      });
    }
  }

  // ==================== TRADE JOURNAL ====================
  let currentJournalCorrelationId = null;

  window.openJournalModal = function(correlationId) {
    currentJournalCorrelationId = correlationId;
    const order = allOrders.find(o => o.correlation_id === correlationId);
    
    const tradeIdEl = document.getElementById('journal-trade-id');
    const tagsEl = document.getElementById('journal-tags');
    const notesEl = document.getElementById('journal-notes');
    const modalEl = document.getElementById('journal-modal');

    if (tradeIdEl) tradeIdEl.innerText = `ID: ${correlationId}`;
    if (tagsEl) tagsEl.value = order && order.tags ? order.tags : '';
    if (notesEl) notesEl.value = order && order.notes ? order.notes : '';
    
    if (modalEl) modalEl.classList.add('active');
  };

  window.closeJournalModal = function() {
    const modalEl = document.getElementById('journal-modal');
    if (modalEl) modalEl.classList.remove('active');
    currentJournalCorrelationId = null;
  };

  window.saveTradeJournal = async function() {
    if (!currentJournalCorrelationId) return;
    
    const tagsVal = document.getElementById('journal-tags').value;
    const notesVal = document.getElementById('journal-notes').value;
    const btn = document.getElementById('save-journal-btn');
    
    if (btn) {
      btn.innerText = "Saving...";
      btn.disabled = true;
    }

    try {
      const res = await fetch('/api/orders/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          correlationId: currentJournalCorrelationId, 
          tags: tagsVal, 
          notes: notesVal 
        })
      });
      
      const data = await res.json();
      if (data.success) {
        // Update local cache so we don't have to refresh the page
        const order = allOrders.find(o => o.correlation_id === currentJournalCorrelationId);
        if (order) {
          order.tags = tagsVal;
          order.notes = notesVal;
        }
        
        window.closeJournalModal();
        fetchOrders(); // Re-render orders table to show the new tags immediately
      } else {
        showToast('Failed to save journal');
      }
    } catch (err) {
      console.error("Failed to save journal:", err);
      showToast('Network error saving journal');
    } finally {
      if (btn) {
        btn.innerText = "Save Journal";
        btn.disabled = false;
      }
    }
  };

})();
