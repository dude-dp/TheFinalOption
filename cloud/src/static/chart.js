// ============================================
// TradingView-Style Canvas Chart Engine
// Dark theme · Candlesticks · MACD Sub-Panel
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
    priceLabelBg: '#2962ff',
  };

  class TradingChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.spots = [];
      this.macd = [];
      this.orders = [];
      this._lastData = null;
      this.dpr = window.devicePixelRatio || 1;
      this.crosshair = null;
      this.monoFont = '"JetBrains Mono", "SF Mono", "Consolas", monospace';
      this.sansFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.canvas.addEventListener('mouseleave', () => {
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

    // --- MACD Signal & Histogram ---
    processMACD(rawData) {
      if (!rawData || rawData.length === 0) return [];
      const period = 9;
      const k = 2 / (period + 1);
      let ema = rawData[0].value;

      return rawData.map((d, i) => {
        if (i > 0) ema = (d.value * k) + (ema * (1 - k));
        const hist = d.value - ema;
        return {
          timestamp: d.timestamp,
          value: d.value,
          signal: ema,
          hist: hist
        };
      });
    }

    updateData(spots, rawMacd, orders = []) {
      this.spots = spots || [];
      this.macd = this.processMACD(rawMacd);
      this.orders = orders;
      this._lastData = { spots: this.spots, macd: rawMacd };
      this.draw();
    }

    formatTime(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    }

    formatDate(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[d.getMonth()]} ${d.getDate()}`;
    }

    handleMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.spots.length === 0) return;

      const rightAxisW = 72;
      const plotW = this.width - rightAxisW;

      // Snap to nearest candle
      const candleSpacing = plotW / this.spots.length;
      let idx = Math.round((x - candleSpacing / 2) / candleSpacing);
      idx = Math.max(0, Math.min(idx, this.spots.length - 1));

      this.crosshair = {
        x: (idx + 0.5) * candleSpacing,
        y: y,
        index: idx
      };

      this.draw();
    }

    // --- Nice axis number formatting ---
    niceSteps(min, max, count) {
      const range = max - min;
      const rawStep = range / count;
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const norm = rawStep / mag;
      let niceStep;
      if (norm <= 1) niceStep = 1 * mag;
      else if (norm <= 2) niceStep = 2 * mag;
      else if (norm <= 5) niceStep = 5 * mag;
      else niceStep = 10 * mag;

      const start = Math.ceil(min / niceStep) * niceStep;
      const labels = [];
      for (let v = start; v <= max; v += niceStep) {
        labels.push(v);
      }
      return labels;
    }

    // ==================== MAIN DRAW ====================
    draw() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      // Layout: right axis width, top legend bar, bottom time axis
      const rightAxisW = 72;
      const timeAxisH = 28;
      const legendH = 28;
      const dividerH = 1;
      const candleRatio = 0.65;

      const plotW = w - rightAxisW;
      const plotH = h - timeAxisH - legendH;

      const candleH = plotH * candleRatio;
      const macdH = plotH * (1 - candleRatio);

      const candleTop = legendH;
      const macdTop = candleTop + candleH + dividerH;

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
      this.drawDivider(ctx, 0, macdTop - 1, plotW);
      this.drawMACDPanel(ctx, 0, macdTop, plotW, macdH, rightAxisW);
      this.drawTimeAxis(ctx, 0, h - timeAxisH, plotW, timeAxisH);
      this.drawCrosshair(ctx, candleTop, candleH, macdTop, macdH, plotW, rightAxisW, timeAxisH);
      this.drawLegend(ctx, 0, 0, plotW, legendH);
    }

    // ==================== CANDLE PANEL ====================
    drawCandlePanel(ctx, startX, startY, plotW, plotH, rightAxisW) {
      const pad = { top: 8, bottom: 8 };
      const drawH = plotH - pad.top - pad.bottom;
      const drawY = startY + pad.top;

      // Price range
      let lo = Infinity, hi = -Infinity;
      this.spots.forEach(d => {
        if (d.low < lo) lo = d.low;
        if (d.high > hi) hi = d.high;
      });
      const range = hi - lo || 1;
      lo -= range * 0.04;
      hi += range * 0.04;

      // Store for crosshair use
      this._candleY = drawY;
      this._candleH = drawH;
      this._candleLo = lo;
      this._candleHi = hi;

      const toY = (v) => drawY + drawH - ((v - lo) / (hi - lo)) * drawH;

      // Horizontal grid lines
      const yLabels = this.niceSteps(lo, hi, 5);
      ctx.strokeStyle = TV.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);

      yLabels.forEach(v => {
        const gy = Math.round(toY(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(startX, gy);
        ctx.lineTo(startX + plotW, gy);
        ctx.stroke();
      });

      // Right axis labels
      ctx.fillStyle = TV.axisText;
      ctx.font = `11px ${this.monoFont}`;
      ctx.textAlign = 'left';
      yLabels.forEach(v => {
        const gy = toY(v);
        ctx.fillText(v.toFixed(2), startX + plotW + 8, gy + 4);
      });

      // Candlesticks
      const candleSpacing = plotW / this.spots.length;
      const bodyW = Math.max(1, candleSpacing * 0.65);
      const wickW = Math.max(1, bodyW < 3 ? 1 : 1);

      this.spots.forEach((d, i) => {
        const cx = startX + (i + 0.5) * candleSpacing;
        const oY = toY(d.open);
        const cY = toY(d.close);
        const hY = toY(d.high);
        const lY = toY(d.low);
        const bull = d.close >= d.open;

        // Wick
        ctx.strokeStyle = bull ? TV.bullWick : TV.bearWick;
        ctx.lineWidth = wickW;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, hY);
        ctx.lineTo(Math.round(cx) + 0.5, lY);
        ctx.stroke();

        // Body
        const bodyTop = Math.min(oY, cY);
        const bodyHeight = Math.max(Math.abs(oY - cY), 1);

        if (bull) {
          // Hollow-ish or filled green
          ctx.fillStyle = TV.bullCandle;
          ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
        } else {
          ctx.fillStyle = TV.bearCandle;
          ctx.fillRect(Math.round(cx - bodyW / 2), bodyTop, Math.round(bodyW), bodyHeight);
        }
      });

      // Current price line + label (like TradingView)
      const lastSpot = this.spots[this.spots.length - 1];
      const lastY = toY(lastSpot.close);
      const bull = lastSpot.close >= lastSpot.open;

      // Dashed price line
      ctx.strokeStyle = bull ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, Math.round(lastY) + 0.5);
      ctx.lineTo(startX + plotW, Math.round(lastY) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price label on right axis
      const labelH = 22;
      const labelW = rightAxisW - 4;
      const labelY = lastY - labelH / 2;
      ctx.fillStyle = bull ? TV.bullCandle : TV.bearCandle;
      ctx.fillRect(startX + plotW, labelY, labelW, labelH);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 11px ${this.monoFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(lastSpot.close.toFixed(2), startX + plotW + labelW / 2, lastY + 4);

      // Execution flags
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

          const cx = startX + (bestIdx + 0.5) * candleSpacing;
          const isBuy = o.transaction_type === 'BUY';
          const color = isBuy ? TV.bullCandle : TV.bearCandle;
          const spotClose = this.spots[bestIdx].close;
          const y = toY(spotClose);

          // Dashed execution line
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(cx, y);
          ctx.lineTo(startX + plotW, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Triangle flag
          ctx.fillStyle = color;
          ctx.beginPath();
          if (isBuy) {
            ctx.moveTo(cx, y + 6);
            ctx.lineTo(cx - 5, y + 14);
            ctx.lineTo(cx + 5, y + 14);
          } else {
            ctx.moveTo(cx, y - 6);
            ctx.lineTo(cx - 5, y - 14);
            ctx.lineTo(cx + 5, y - 14);
          }
          ctx.fill();

          // Label
          ctx.fillStyle = TV.legendText;
          ctx.font = `10px ${this.monoFont}`;
          ctx.textAlign = 'center';
          const labelText = `${o.transaction_type} ₹${(o.execution_price || 0).toFixed(1)}`;
          ctx.fillText(labelText, cx, isBuy ? y + 24 : y - 20);
        });
      }
    }

    // ==================== DIVIDER ====================
    drawDivider(ctx, x, y, w) {
      ctx.strokeStyle = TV.panelBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y) + 0.5);
      ctx.lineTo(x + w, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // ==================== MACD PANEL ====================
    drawMACDPanel(ctx, startX, startY, plotW, plotH, rightAxisW) {
      const pad = { top: 6, bottom: 6 };
      const drawH = plotH - pad.top - pad.bottom;
      const drawY = startY + pad.top;

      if (this.macd.length === 0) return;

      // Find absolute max
      let maxAbs = 0;
      this.macd.forEach(d => {
        maxAbs = Math.max(maxAbs, Math.abs(d.value), Math.abs(d.signal), Math.abs(d.hist));
      });
      const hi = maxAbs * 1.15 || 1;
      const lo = -hi;

      this._macdY = drawY;
      this._macdH = drawH;
      this._macdHi = hi;
      this._macdLo = lo;

      const toY = (v) => drawY + drawH - ((v - lo) / (hi - lo)) * drawH;
      const zeroY = toY(0);

      // Grid: zero line
      ctx.strokeStyle = TV.panelBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, Math.round(zeroY) + 0.5);
      ctx.lineTo(startX + plotW, Math.round(zeroY) + 0.5);
      ctx.stroke();

      // Right axis labels for MACD
      const macdLabels = this.niceSteps(lo, hi, 3);
      ctx.fillStyle = TV.axisText;
      ctx.font = `10px ${this.monoFont}`;
      ctx.textAlign = 'left';
      macdLabels.forEach(v => {
        const gy = toY(v);
        ctx.strokeStyle = TV.gridLight;
        ctx.beginPath();
        ctx.moveTo(startX, Math.round(gy) + 0.5);
        ctx.lineTo(startX + plotW, Math.round(gy) + 0.5);
        ctx.stroke();
        ctx.fillText(v.toFixed(2), startX + plotW + 8, gy + 3);
      });

      const candleSpacing = plotW / this.spots.length;
      const barW = Math.max(1, candleSpacing * 0.55);

      // Map MACD to Spots by time to ensure perfect vertical alignment
      const mappedMacd = this.spots.map(spot => {
        const spotTime = new Date(spot.timestamp).getTime();
        let best = null;
        let bestDist = Infinity;
        for (const m of this.macd) {
          const dist = Math.abs(new Date(m.timestamp).getTime() - spotTime);
          if (dist < bestDist && dist < 5 * 60000) { // Within 5 mins max
            bestDist = dist;
            best = m;
          }
        }
        return best;
      });

      // 1. Histogram bars with gradient (fading vs growing)
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = startX + (i + 0.5) * candleSpacing;
        const histH = Math.abs(toY(d.hist) - zeroY);
        
        // Find previous valid MACD for coloring
        let prev = d;
        for (let j = i - 1; j >= 0; j--) {
          if (mappedMacd[j]) { prev = mappedMacd[j]; break; }
        }

        let color;
        if (d.hist >= 0) {
          color = d.hist >= prev.hist ? TV.histBull : TV.histBullDark;
        } else {
          color = d.hist <= prev.hist ? TV.histBear : TV.histBearDark;
        }

        ctx.fillStyle = color;
        if (d.hist >= 0) {
          ctx.fillRect(Math.round(cx - barW / 2), zeroY - histH, Math.round(barW), histH);
        } else {
          ctx.fillRect(Math.round(cx - barW / 2), zeroY, Math.round(barW), histH);
        }
      });

      // 2. MACD Line
      ctx.strokeStyle = TV.macdLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = startX + (i + 0.5) * candleSpacing;
        const cy = toY(d.value);
        if (!started) { ctx.moveTo(cx, cy); started = true; }
        else { ctx.lineTo(cx, cy); }
      });
      ctx.stroke();

      // 3. Signal Line
      ctx.strokeStyle = TV.signalLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      started = false;
      mappedMacd.forEach((d, i) => {
        if (!d) return;
        const cx = startX + (i + 0.5) * candleSpacing;
        const cy = toY(d.signal);
        if (!started) { ctx.moveTo(cx, cy); started = true; }
        else { ctx.lineTo(cx, cy); }
      });
      ctx.stroke();
    }

    // ==================== TIME AXIS ====================
    drawTimeAxis(ctx, startX, startY, plotW, axisH) {
      // Top border of time axis
      ctx.strokeStyle = TV.panelBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, Math.round(startY) + 0.5);
      ctx.lineTo(startX + plotW, Math.round(startY) + 0.5);
      ctx.stroke();

      ctx.fillStyle = TV.axisText;
      ctx.font = `11px ${this.monoFont}`;
      ctx.textAlign = 'center';

      const candleSpacing = plotW / this.spots.length;
      let lastLabel = '';

      for (let i = 0; i < this.spots.length; i++) {
        const ts = this.spots[i].timestamp;
        const time = this.formatTime(ts);
        if (!time) continue;

        // Show label every ~30 candles or on :00/:30 marks
        const show = time.endsWith(':00') || time.endsWith(':30');
        if (show && time !== lastLabel) {
          const cx = startX + (i + 0.5) * candleSpacing;
          
          // Subtle vertical grid line through all panels
          ctx.strokeStyle = TV.gridLight;
          ctx.beginPath();
          ctx.moveTo(Math.round(cx) + 0.5, 0);
          ctx.lineTo(Math.round(cx) + 0.5, startY);
          ctx.stroke();

          // Tick mark
          ctx.strokeStyle = TV.panelBorder;
          ctx.beginPath();
          ctx.moveTo(cx, startY);
          ctx.lineTo(cx, startY + 5);
          ctx.stroke();

          ctx.fillText(time, cx, startY + axisH - 6);
          lastLabel = time;
        }
      }
    }

    // ==================== LEGEND ====================
    drawLegend(ctx, x, y, plotW, legendH) {
      const lx = x + 12;
      const ly = y + legendH / 2 + 4;
      
      if (this.spots.length === 0) return;

      // If crosshair active, show that candle, otherwise show latest
      const idx = this.crosshair ? this.crosshair.index : this.spots.length - 1;
      const d = this.spots[idx];
      const m = this.macd[idx];

      const bull = d.close >= d.open;
      const change = d.close - d.open;
      const changePct = ((change / d.open) * 100);

      // OHLC header
      ctx.font = `11px ${this.monoFont}`;
      let cx = lx;

      const drawLabel = (label, value, color) => {
        ctx.fillStyle = TV.legendMuted;
        ctx.textAlign = 'left';
        ctx.fillText(label, cx, ly);
        cx += ctx.measureText(label).width + 2;
        ctx.fillStyle = color || TV.legendText;
        ctx.fillText(value, cx, ly);
        cx += ctx.measureText(value).width + 12;
      };

      drawLabel('O', d.open.toFixed(2), bull ? TV.bullCandle : TV.bearCandle);
      drawLabel('H', d.high.toFixed(2), bull ? TV.bullCandle : TV.bearCandle);
      drawLabel('L', d.low.toFixed(2), bull ? TV.bullCandle : TV.bearCandle);
      drawLabel('C', d.close.toFixed(2), bull ? TV.bullCandle : TV.bearCandle);

      // Change
      const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
      ctx.fillStyle = bull ? TV.bullCandle : TV.bearCandle;
      ctx.fillText(changeStr, cx, ly);
      cx += ctx.measureText(changeStr).width + 20;

      // MACD values
      if (m) {
        ctx.fillStyle = TV.legendMuted;
        ctx.fillText('MACD', cx, ly);
        cx += ctx.measureText('MACD').width + 4;
        ctx.fillStyle = TV.macdLine;
        ctx.fillText(m.value.toFixed(2), cx, ly);
        cx += ctx.measureText(m.value.toFixed(2)).width + 8;

        ctx.fillStyle = TV.legendMuted;
        ctx.fillText('Sig', cx, ly);
        cx += ctx.measureText('Sig').width + 4;
        ctx.fillStyle = TV.signalLine;
        ctx.fillText(m.signal.toFixed(2), cx, ly);
        cx += ctx.measureText(m.signal.toFixed(2)).width + 8;

        ctx.fillStyle = TV.legendMuted;
        ctx.fillText('Hist', cx, ly);
        cx += ctx.measureText('Hist').width + 4;
        ctx.fillStyle = m.hist >= 0 ? TV.bullCandle : TV.bearCandle;
        ctx.fillText(m.hist.toFixed(2), cx, ly);
      }
    }

    // ==================== CROSSHAIR ====================
    drawCrosshair(ctx, candleTop, candleH, macdTop, macdH, plotW, rightAxisW, timeAxisH) {
      if (!this.crosshair) return;

      const idx = this.crosshair.index;
      const spot = this.spots[idx];
      if (!spot) return;

      const mx = this.crosshair.x;
      const my = this.crosshair.y;

      // Vertical line (full height)
      ctx.strokeStyle = TV.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(mx) + 0.5, 0);
      ctx.lineTo(Math.round(mx) + 0.5, this.height - timeAxisH);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, Math.round(my) + 0.5);
      ctx.lineTo(plotW, Math.round(my) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Time label on bottom axis
      const time = this.formatTime(spot.timestamp);
      if (time) {
        const tw = ctx.measureText(time).width + 16;
        const tlx = mx - tw / 2;
        const tly = this.height - timeAxisH;

        ctx.fillStyle = TV.crossLabelBg;
        ctx.fillRect(tlx, tly, tw, timeAxisH);
        ctx.fillStyle = '#d1d4dc';
        ctx.font = `11px ${this.monoFont}`;
        ctx.textAlign = 'center';
        ctx.fillText(time, mx, tly + timeAxisH - 8);
      }

      // Price label on right axis (if cursor is in candle area)
      if (my >= candleTop && my <= candleTop + candleH && this._candleHi !== undefined) {
        const priceAtY = this._candleHi - ((my - this._candleY) / this._candleH) * (this._candleHi - this._candleLo);
        const labelW = rightAxisW - 4;
        const labelH = 20;

        ctx.fillStyle = TV.crossLabelBg;
        ctx.fillRect(plotW, my - labelH / 2, labelW, labelH);
        ctx.fillStyle = '#d1d4dc';
        ctx.font = `11px ${this.monoFont}`;
        ctx.textAlign = 'center';
        ctx.fillText(priceAtY.toFixed(2), plotW + labelW / 2, my + 4);
      }

      // MACD value label on right axis (if cursor is in MACD area)
      if (my >= macdTop && my <= macdTop + macdH && this._macdHi !== undefined) {
        const macdAtY = this._macdHi - ((my - this._macdY) / this._macdH) * (this._macdHi - this._macdLo);
        const labelW = rightAxisW - 4;
        const labelH = 20;

        ctx.fillStyle = TV.crossLabelBg;
        ctx.fillRect(plotW, my - labelH / 2, labelW, labelH);
        ctx.fillStyle = '#d1d4dc';
        ctx.font = `10px ${this.monoFont}`;
        ctx.textAlign = 'center';
        ctx.fillText(macdAtY.toFixed(2), plotW + labelW / 2, my + 4);
      }

      // Magnetic dot on close price
      if (this._candleHi !== undefined) {
        const closeY = this._candleY + this._candleH - ((spot.close - this._candleLo) / (this._candleHi - this._candleLo)) * this._candleH;
        ctx.fillStyle = TV.legendText;
        ctx.beginPath();
        ctx.arc(mx, closeY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  window.TradingChart = TradingChart;
})();
