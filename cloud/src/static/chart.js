// ============================================
// TradingView-Style Interactive Chart Engine
// Features: Pan, Zoom, Auto-Scale, Touch Support
// ============================================

(function () {
  'use strict';

  // TradingView dark palette
  const TV = {
    bg:           '#131722',
    panelBorder:  '#2a2e39',
    grid:         'rgba(42, 46, 57, 0.6)',
    gridLight:    'rgba(42, 46, 57, 0.3)',
    axisText:     '#787b86',
    legendText:   '#d1d4dc',
    legendMuted:  '#787b86',
    white:        '#d1d4dc',
    bullCandle:   '#26a69a',
    bearCandle:   '#ef5350',
    bullWick:     '#26a69a',
    bearWick:     '#ef5350',
    macdLine:     '#2962ff',
    signalLine:   '#ff6d00',
    histBull:     'rgba(38, 166, 154, 0.5)',
    histBear:     'rgba(239, 83, 80, 0.5)',
    histBullDark: 'rgba(38, 166, 154, 0.25)',
    histBearDark: 'rgba(239, 83, 80, 0.25)',
    crosshair:    'rgba(120, 123, 134, 0.4)',
    crossLabel:   '#131722',
    crossLabelBg: '#4c525e',
    priceLine:    'rgba(42, 46, 57, 0.9)',
    priceLabel:   '#131722',
  };

  class TradingChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.spots = [];
      this.macd = [];
      this.orders = [];
      this.dpr = window.devicePixelRatio || 1;
      this.crosshair = null;
      this.monoFont = '"JetBrains Mono", "SF Mono", "Consolas", monospace';
      this.sansFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      // --- Interactive State ---
      this.candleWidth = null; // Dynamically calculated
      this.offsetX = 0; // Panning offset
      this.isDragging = false;
      this.lastMouseX = 0;
      this.minCandleWidth = 2;
      this.maxCandleWidth = 100;
      
      this.canvas.style.touchAction = 'none'; // Prevent pull-to-refresh on mobile
      this.canvas.style.cursor = 'crosshair';

      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.bindEvents();
    }

    bindEvents() {
      // Mouse Events
      this.canvas.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.canvas.style.cursor = 'grabbing';
      });

      this.canvas.addEventListener('mouseup', () => {
        this.isDragging = false;
        this.canvas.style.cursor = 'crosshair';
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.isDragging = false;
        this.crosshair = null;
        this.canvas.style.cursor = 'crosshair';
        this.draw();
      });

      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e.clientX, e.clientY));
      
      // Zoom Event
      this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

      // Touch Events (Mobile)
      this.canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          this.isDragging = true;
          this.lastMouseX = e.touches[0].clientX;
          this.handleMouseMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (this.isDragging && e.touches.length === 1) {
          this.handleMouseMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      this.canvas.addEventListener('touchend', () => {
        this.isDragging = false;
        this.crosshair = null;
        this.draw();
      });
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const h = rect.height || 520;
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = h * this.dpr;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.width = rect.width;
      this.height = h;
      this.draw();
    }

    // --- Core Coordinate Math ---
    getX(index) {
      if (this.spots.length === 0) return 0;
      const plotW = this.width - 72;
      return plotW - this.offsetX - (this.spots.length - 1 - index) * this.candleWidth - this.candleWidth / 2;
    }

    getIndex(x) {
      if (this.spots.length === 0) return -1;
      const plotW = this.width - 72;
      const exactIdx = this.spots.length - 1 - (plotW - this.offsetX - this.candleWidth / 2 - x) / this.candleWidth;
      return Math.max(0, Math.min(Math.round(exactIdx), this.spots.length - 1));
    }

    // --- Interaction Handlers ---
    handleMouseMove(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (this.isDragging) {
        const deltaX = clientX - this.lastMouseX;
        this.offsetX -= deltaX;
        
        // Clamp panning bounds
        const maxOffset = this.spots.length * this.candleWidth;
        if (this.offsetX < -this.width / 2) this.offsetX = -this.width / 2;
        if (this.offsetX > maxOffset) this.offsetX = maxOffset;
        
        this.lastMouseX = clientX;
        this.crosshair = null; // Hide crosshair while panning
        this.draw();
        return;
      }

      if (this.spots.length === 0) return;
      const idx = this.getIndex(x);
      
      this.crosshair = { x: this.getX(idx), y: y, index: idx };
      this.draw();
    }

    handleWheel(e) {
      e.preventDefault();
      if (this.spots.length === 0) return;
      
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plotW = this.width - 72;
      if (x > plotW) return; // Ignore zoom if hovering over the price axis

      // Determine continuous index directly under the mouse
      const continuousIndex = this.spots.length - 1 - (plotW - this.offsetX - x) / this.candleWidth;

      // Calculate Zoom Factor (smooth easing)
      const zoomSensitivity = 0.0015;
      const zoomFactor = Math.pow(1 + zoomSensitivity, -e.deltaY);
      
      this.candleWidth *= zoomFactor;
      
      // Clamp zoom bounds
      if (this.candleWidth < this.minCandleWidth) this.candleWidth = this.minCandleWidth;
      if (this.candleWidth > this.maxCandleWidth) this.candleWidth = this.maxCandleWidth;

      // Adjust offset so the candle under the mouse stays exactly under the mouse
      this.offsetX = plotW - x - (this.spots.length - 1 - continuousIndex) * this.candleWidth;
      
      this.draw();
    }

    processMACD(rawData) {
      if (!rawData || rawData.length === 0) return [];
      const period = 9;
      const k = 2 / (period + 1);
      let ema = rawData[0].value;

      return rawData.map((d, i) => {
        if (i > 0) ema = (d.value * k) + (ema * (1 - k));
        const hist = d.value - ema;
        return { timestamp: d.timestamp, value: d.value, signal: ema, hist: hist };
      });
    }

    updateData(spots, rawMacd, orders = []) {
      this.spots = spots || [];
      this.macd = this.processMACD(rawMacd);
      this.orders = orders;

      // Initialize zoom level to fit ~60 candles on first load
      if (!this.candleWidth && this.spots.length > 0) {
        const plotW = this.width - 72;
        this.candleWidth = plotW / Math.min(this.spots.length, 60);
        this.offsetX = 0; // Right align latest data
      }
      this.draw();
    }

    formatTime(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // ==================== MAIN DRAW ====================
    draw() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      const rightAxisW = 72;
      const timeAxisH = 28;
      const legendH = 28;
      const candleRatio = 0.65;
      const plotW = w - rightAxisW;
      const plotH = h - timeAxisH - legendH;
      const candleH = plotH * candleRatio;
      const macdH = plotH * (1 - candleRatio);
      const candleTop = legendH;
      const macdTop = candleTop + candleH + 1;

      // Background
      ctx.fillStyle = TV.bg;
      ctx.fillRect(0, 0, w, h);

      if (this.spots.length < 2) {
        ctx.fillStyle = TV.axisText;
        ctx.font = `13px ${this.sansFont}`;
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting live market data...', w / 2, h / 2);
        return;
      }

      this.drawCandlePanel(ctx, 0, candleTop, plotW, candleH, rightAxisW);
      
      // Divider
      ctx.strokeStyle = TV.panelBorder;
      ctx.beginPath(); ctx.moveTo(0, Math.round(macdTop - 1) + 0.5); ctx.lineTo(plotW, Math.round(macdTop - 1) + 0.5); ctx.stroke();
      
      this.drawMACDPanel(ctx, 0, macdTop, plotW, macdH, rightAxisW);
      this.drawTimeAxis(ctx, 0, h - timeAxisH, plotW, timeAxisH);
      this.drawCrosshair(ctx, candleTop, candleH, macdTop, macdH, plotW, rightAxisW, timeAxisH);
      this.drawLegend(ctx, 0, 0, plotW, legendH);
    }

    // ==================== CANDLE PANEL ====================
    drawCandlePanel(ctx, startX, startY, plotW, plotH, rightAxisW) {
      const pad = { top: 12, bottom: 12 };
      const drawH = plotH - pad.top - pad.bottom;
      const drawY = startY + pad.top;

      // 1. Calculate dynamic Auto-Scale based ONLY on visible candles
      let visLo = Infinity, visHi = -Infinity;
      this.spots.forEach((d, i) => {
        const cx = this.getX(i);
        if (cx > -this.candleWidth && cx < plotW + this.candleWidth) {
          if (d.low < visLo) visLo = d.low;
          if (d.high > visHi) visHi = d.high;
        }
      });
      if (visLo === Infinity) { visLo = 0; visHi = 100; }
      
      const range = visHi - visLo || 1;
      visLo -= range * 0.05;
      visHi += range * 0.05;

      this._candleY = drawY; this._candleH = drawH; this._candleLo = visLo; this._candleHi = visHi;
      const toY = (v) => drawY + drawH - ((v - visLo) / (visHi - visLo)) * drawH;

      // 2. Draw Y-Axis Grid & Labels
      const yLabels = this.niceSteps(visLo, visHi, 5);
      ctx.fillStyle = TV.axisText;
      ctx.font = `11px ${this.monoFont}`;
      ctx.textAlign = 'left';
      ctx.strokeStyle = TV.grid;
      ctx.lineWidth = 1;

      yLabels.forEach(v => {
        const gy = Math.round(toY(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(startX, gy); ctx.lineTo(startX + plotW, gy); ctx.stroke();
        ctx.fillText(v.toFixed(2), startX + plotW + 8, gy + 4);
      });

      // 3. Setup Clipping Region to prevent overflow into axes
      ctx.save();
      ctx.beginPath();
      ctx.rect(startX, startY, plotW, plotH);
      ctx.clip();

      const bodyW = Math.max(1, this.candleWidth * 0.65);
      const wickW = 1;

      // 4. Draw Candles
      this.spots.forEach((d, i) => {
        const cx = this.getX(i);
        if (cx < -this.candleWidth || cx > plotW + this.candleWidth) return; // Skip off-screen

        const oY = toY(d.open), cY = toY(d.close), hY = toY(d.high), lY = toY(d.low);
        const bull = d.close >= d.open;

        ctx.strokeStyle = bull ? TV.bullWick : TV.bearWick;
        ctx.lineWidth = wickW;
        ctx.beginPath(); ctx.moveTo(Math.round(cx), hY); ctx.lineTo(Math.round(cx), lY); ctx.stroke();

        const bodyTop = Math.min(oY, cY);
        const bodyHeight = Math.max(Math.abs(oY - cY), 1);
        ctx.fillStyle = bull ? TV.bullCandle : TV.bearCandle;
        ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
      });

      // 5. Draw Execution Flags
      if (this.orders && this.orders.length > 0) {
        this.orders.forEach(o => {
          if (o.order_status !== 'FILLED') return;
          const orderTime = new Date(o.created_at).getTime();
          let bestIdx = -1, bestDist = Infinity;
          this.spots.forEach((d, i) => {
            const dist = Math.abs(new Date(d.timestamp).getTime() - orderTime);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          });
          if (bestIdx === -1) return;

          const cx = this.getX(bestIdx);
          if (cx < -50 || cx > plotW + 50) return; // Cull if far off-screen

          const isBuy = o.transaction_type === 'BUY';
          const color = isBuy ? TV.bullCandle : TV.bearCandle;
          const y = toY(this.spots[bestIdx].close);

          ctx.strokeStyle = color; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(startX + plotW, y); ctx.stroke(); ctx.setLineDash([]);

          ctx.fillStyle = color; ctx.beginPath();
          if (isBuy) { ctx.moveTo(cx, y + 6); ctx.lineTo(cx - 5, y + 14); ctx.lineTo(cx + 5, y + 14); } 
          else { ctx.moveTo(cx, y - 6); ctx.lineTo(cx - 5, y - 14); ctx.lineTo(cx + 5, y - 14); }
          ctx.fill();

          ctx.fillStyle = TV.legendText; ctx.font = `10px ${this.monoFont}`; ctx.textAlign = 'center';
          ctx.fillText(`${o.transaction_type} ₹${(o.execution_price || 0).toFixed(1)}`, cx, isBuy ? y + 24 : y - 20);
        });
      }
      
      // 6. Draw Active Price Line (if the last candle is visible)
      const lastIdx = this.spots.length - 1;
      const lastSpot = this.spots[lastIdx];
      const lastY = toY(lastSpot.close);
      const bullLine = lastSpot.close >= lastSpot.open;

      ctx.strokeStyle = bullLine ? TV.histBull : TV.histBear;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(startX, Math.round(lastY) + 0.5); ctx.lineTo(startX + plotW, Math.round(lastY) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore(); // END CLIP

      // 7. Right Axis Price Label (Always visible outside clip)
      const labelW = rightAxisW - 4;
      ctx.fillStyle = bullLine ? TV.bullCandle : TV.bearCandle;
      ctx.fillRect(startX + plotW, lastY - 11, labelW, 22);
      ctx.fillStyle = '#ffffff'; ctx.font = `bold 11px ${this.monoFont}`; ctx.textAlign = 'center';
      ctx.fillText(lastSpot.close.toFixed(2), startX + plotW + labelW / 2, lastY + 4);
    }

    // ==================== MACD PANEL ====================
    drawMACDPanel(ctx, startX, startY, plotW, plotH, rightAxisW) {
      const drawH = plotH - 12, drawY = startY + 6;
      if (this.macd.length === 0) return;

      const parseTimeSafe = (ts) => {
        if (!ts) return 0;
        let s = ts;
        if (typeof s === 'string' && !s.includes('Z') && !s.includes('+')) s = s.replace(' ', 'T') + 'Z';
        return new Date(s).getTime();
      };

      const mappedMacd = this.spots.map(spot => {
        const spotTime = parseTimeSafe(spot.timestamp);
        let best = null, bestDist = Infinity;
        for (const m of this.macd) {
          const dist = Math.abs(parseTimeSafe(m.timestamp) - spotTime);
          if (dist < bestDist && dist < 5 * 60000) { bestDist = dist; best = m; }
        }
        return best;
      });

      // Auto-scale MACD
      let maxAbs = 0;
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = this.getX(i);
        if (cx > -this.candleWidth && cx < plotW + this.candleWidth) {
          maxAbs = Math.max(maxAbs, Math.abs(d.value), Math.abs(d.signal), Math.abs(d.hist));
        }
      });
      const hi = maxAbs * 1.15 || 1, lo = -hi;
      this._macdY = drawY; this._macdH = drawH; this._macdHi = hi; this._macdLo = lo;
      const toY = (v) => drawY + drawH - ((v - lo) / (hi - lo)) * drawH;
      const zeroY = toY(0);

      ctx.strokeStyle = TV.panelBorder; ctx.beginPath(); ctx.moveTo(startX, Math.round(zeroY)+0.5); ctx.lineTo(plotW, Math.round(zeroY)+0.5); ctx.stroke();
      
      const macdLabels = this.niceSteps(lo, hi, 3);
      ctx.fillStyle = TV.axisText; ctx.font = `10px ${this.monoFont}`; ctx.textAlign = 'left';
      macdLabels.forEach(v => {
        const gy = toY(v);
        ctx.strokeStyle = TV.gridLight; ctx.beginPath(); ctx.moveTo(startX, Math.round(gy)+0.5); ctx.lineTo(plotW, Math.round(gy)+0.5); ctx.stroke();
        ctx.fillText(v.toFixed(2), plotW + 8, gy + 3);
      });

      ctx.save(); ctx.beginPath(); ctx.rect(startX, startY, plotW, plotH); ctx.clip();

      const barW = Math.max(1, this.candleWidth * 0.55);
      
      // Histograms
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = this.getX(i);
        if (cx < -this.candleWidth || cx > plotW + this.candleWidth) return;
        const histH = Math.abs(toY(d.hist) - zeroY);
        let prev = d;
        for (let j = i - 1; j >= 0; j--) { if (mappedMacd[j]) { prev = mappedMacd[j]; break; } }
        
        ctx.fillStyle = d.hist >= 0 ? (d.hist >= prev.hist ? TV.histBull : TV.histBullDark) : (d.hist <= prev.hist ? TV.histBear : TV.histBearDark);
        ctx.fillRect(Math.round(cx - barW / 2), d.hist >= 0 ? zeroY - histH : zeroY, Math.round(barW), histH);
      });

      // MACD Line
      ctx.strokeStyle = TV.macdLine; ctx.lineWidth = 1.5; ctx.beginPath();
      let started = false;
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = this.getX(i);
        if (cx < -100 || cx > plotW + 100) return; // Pad slightly for continuous lines
        started ? ctx.lineTo(cx, toY(d.value)) : (ctx.moveTo(cx, toY(d.value)), started = true);
      });
      ctx.stroke();

      // Signal Line
      ctx.strokeStyle = TV.signalLine; ctx.beginPath(); started = false;
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = this.getX(i);
        if (cx < -100 || cx > plotW + 100) return;
        started ? ctx.lineTo(cx, toY(d.signal)) : (ctx.moveTo(cx, toY(d.signal)), started = true);
      });
      ctx.stroke();
      ctx.restore();
    }

    // ==================== TIME AXIS ====================
    drawTimeAxis(ctx, startX, startY, plotW, axisH) {
      ctx.strokeStyle = TV.panelBorder; ctx.beginPath(); ctx.moveTo(startX, Math.round(startY)+0.5); ctx.lineTo(plotW, Math.round(startY)+0.5); ctx.stroke();
      ctx.fillStyle = TV.axisText; ctx.font = `11px ${this.monoFont}`; ctx.textAlign = 'center';

      let lastLabelX = -100; // Track physical distance for responsive labels
      for (let i = 0; i < this.spots.length; i++) {
        const cx = this.getX(i);
        if (cx < 0 || cx > plotW) continue;
        const time = this.formatTime(this.spots[i].timestamp);
        if (!time) continue;

        // Dynamic tick intervals: 15m marks
        const show = time.endsWith(':00') || time.endsWith(':15') || time.endsWith(':30') || time.endsWith(':45');
        if (show && (cx - lastLabelX > 60)) { // Ensure labels are at least 60px apart
          ctx.strokeStyle = TV.gridLight; ctx.beginPath(); ctx.moveTo(Math.round(cx)+0.5, 0); ctx.lineTo(Math.round(cx)+0.5, startY); ctx.stroke();
          ctx.strokeStyle = TV.panelBorder; ctx.beginPath(); ctx.moveTo(cx, startY); ctx.lineTo(cx, startY + 5); ctx.stroke();
          ctx.fillText(time, cx, startY + axisH - 6);
          lastLabelX = cx;
        }
      }
    }

    // ==================== LEGEND ====================
    drawLegend(ctx, x, y, plotW, legendH) {
      if (this.spots.length === 0) return;
      const idx = this.crosshair ? this.crosshair.index : this.spots.length - 1;
      const d = this.spots[idx];
      const m = this.macd[idx];
      const bull = d.close >= d.open;
      const change = d.close - d.open;

      ctx.font = `11px ${this.monoFont}`; let cx = x + 12; const ly = y + legendH / 2 + 4;
      const drawL = (lbl, val) => {
        ctx.fillStyle = TV.legendMuted; ctx.fillText(lbl, cx, ly); cx += ctx.measureText(lbl).width + 2;
        ctx.fillStyle = bull ? TV.bullCandle : TV.bearCandle; ctx.fillText(val, cx, ly); cx += ctx.measureText(val).width + 12;
      };

      drawL('O', d.open.toFixed(2)); drawL('H', d.high.toFixed(2)); drawL('L', d.low.toFixed(2)); drawL('C', d.close.toFixed(2));
      ctx.fillText(`${change >= 0 ? '+' : ''}${change.toFixed(2)}`, cx, ly);
    }

    // ==================== CROSSHAIR ====================
    drawCrosshair(ctx, candleTop, candleH, macdTop, macdH, plotW, rightAxisW, timeAxisH) {
      if (!this.crosshair || this.spots.length === 0) return;
      
      const mx = this.getX(this.crosshair.index);
      if (mx < 0 || mx > plotW) return; // Don't draw if crosshair is panned off-screen

      const my = this.crosshair.y;
      ctx.strokeStyle = TV.crosshair; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(mx)+0.5, 0); ctx.lineTo(Math.round(mx)+0.5, this.height - timeAxisH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, Math.round(my)+0.5); ctx.lineTo(plotW, Math.round(my)+0.5); ctx.stroke(); ctx.setLineDash([]);

      const time = this.formatTime(this.spots[this.crosshair.index].timestamp);
      if (time) {
        const tw = ctx.measureText(time).width + 16, tly = this.height - timeAxisH;
        ctx.fillStyle = TV.crossLabelBg; ctx.fillRect(mx - tw/2, tly, tw, timeAxisH);
        ctx.fillStyle = TV.white; ctx.font = `11px ${this.monoFont}`; ctx.textAlign = 'center'; ctx.fillText(time, mx, tly + timeAxisH - 8);
      }

      const drawLabel = (areaY, areaH, scaleHi, scaleLo) => {
        if (my >= areaY && my <= areaY + areaH && scaleHi !== undefined) {
          const val = scaleHi - ((my - areaY) / areaH) * (scaleHi - scaleLo);
          ctx.fillStyle = TV.crossLabelBg; ctx.fillRect(plotW, my - 10, rightAxisW - 4, 20);
          ctx.fillStyle = TV.white; ctx.fillText(val.toFixed(2), plotW + (rightAxisW - 4)/2, my + 4);
        }
      };

      drawLabel(this._candleY, this._candleH, this._candleHi, this._candleLo);
      drawLabel(this._macdY, this._macdH, this._macdHi, this._macdLo);
    }

    niceSteps(min, max, count) {
      const range = max - min, mag = Math.pow(10, Math.floor(Math.log10(range / count))), norm = (range / count) / mag;
      const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
      const labels = [];
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) labels.push(v);
      return labels;
    }
  }

  window.TradingChart = TradingChart;

  async function renderTimeOfDayChart() {
    try {
      const res = await fetch('/api/analytics/time-of-day');
      const json = await res.json();
      
      const labels = [];
      const pnlData = [];
      const backgroundColors = [];

      (json.data || []).forEach(row => {
        // Format hour (e.g., "09" -> "09:00 AM")
        const hour = parseInt(row.trading_hour);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        labels.push(`${displayHour}:00 ${ampm}`);
        
        pnlData.push(row.total_pnl);
        
        // Green for profitable hours, Red for losing hours
        if (row.total_pnl >= 0) {
          backgroundColors.push('rgba(0, 230, 118, 0.6)'); // Institutional Green
        } else {
          backgroundColors.push('rgba(255, 23, 68, 0.6)');  // Deep Red
        }
      });

      const canvas = document.getElementById('timeOfDayChart');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      // @ts-ignore
      new Chart(ctx, {
        type: 'polarArea',
        data: {
          labels: labels,
          datasets: [{
            label: 'Cumulative PnL (₹)',
            data: pnlData,
            backgroundColor: backgroundColors,
            borderWidth: 1,
            borderColor: '#1e1e1e'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              ticks: { display: false },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          },
          plugins: {
            legend: { position: 'right', labels: { color: '#a0a0a0' } }
          }
        }
      });
    } catch (err) {
      console.error('Failed to load Time-of-Day chart', err);
    }
  }

  // Ensure Chart.js is loaded then run
  document.addEventListener('DOMContentLoaded', () => {
    renderTimeOfDayChart();
  });
})();
