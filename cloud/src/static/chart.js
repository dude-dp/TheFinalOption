// ============================================
// HTML5 Canvas Chart — Professional OHLC + MACD Complete
// Client-side rendering with Crosshairs & Axes
// ============================================

(function () {
  'use strict';

  class TradingChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.spots = [];
      this.macd = []; // Will hold {timestamp, value, signal, hist}
      this.dpr = window.devicePixelRatio || 1;
      this.crosshair = null;

      // Extract colors dynamically from CSS variables
      const style = getComputedStyle(document.body);
      this.theme = {
        bg: 'transparent',
        grid: style.getPropertyValue('--border').trim() || 'rgba(255, 255, 255, 0.08)',
        text: style.getPropertyValue('--text-muted').trim() || '#a1a1aa',
        textDark: style.getPropertyValue('--text-primary').trim() || '#f8fafc',
        buy: style.getPropertyValue('--accent-buy').trim() || '#10b981',
        sell: style.getPropertyValue('--accent-sell').trim() || '#ef4444',
        macdLine: style.getPropertyValue('--accent-blue').trim() || '#3b82f6',
        signalLine: style.getPropertyValue('--accent-orange').trim() || '#f59e0b',
        crosshair: 'rgba(255, 255, 255, 0.2)',
        tooltipBg: style.getPropertyValue('--surface-elevated').trim() || '#27272a'
      };

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
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = 400 * this.dpr; // Slightly taller to fit axes
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = '400px';
      this.ctx.scale(this.dpr, this.dpr);
      this.width = rect.width;
      this.height = 400;
      this.draw();
    }

    // --- On-The-Fly Signal & Histogram Calculation ---
    processMACD(rawData) {
      if (!rawData || rawData.length === 0) return [];
      const period = 9;
      const k = 2 / (period + 1);
      let ema = rawData[0].value; // Seed with first MACD value

      return rawData.map((d, i) => {
        if (i > 0) ema = (d.value * k) + (ema * (1 - k)); // Calculate 9-EMA
        const hist = d.value - ema; // Histogram = MACD - Signal
        return {
          timestamp: d.timestamp,
          value: d.value, // MACD Line
          signal: ema,    // Signal Line
          hist: hist      // Histogram
        };
      });
    }

    updateData(spots, rawMacd) {
      this.spots = spots || [];
      this.macd = this.processMACD(rawMacd);
      this.draw();
    }

    formatTime(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    handleMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.spots.length === 0) return;

      const padding = { left: 10, right: 65, top: 20, bottom: 25 };
      const plotW = this.width - padding.left - padding.right;
      
      let closestIdx = Math.round(((x - padding.left) / plotW) * (this.spots.length - 1));
      closestIdx = Math.max(0, Math.min(closestIdx, this.spots.length - 1));

      this.crosshair = {
        x: padding.left + (closestIdx / (this.spots.length - 1)) * plotW,
        y: y,
        index: closestIdx
      };
      
      this.draw();
    }

    draw() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      
      const gap = h * 0.05;
      const spotH = h * 0.55;
      const macdH = h * 0.30;
      const padding = { left: 10, right: 65, top: 20, bottom: 25 };

      ctx.clearRect(0, 0, w, h); // Clear for transparent bento background

      if (this.spots.length < 2) {
        ctx.fillStyle = this.theme.text;
        ctx.font = '13px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting live market data...', w / 2, h / 2);
        return;
      }

      this.drawCandles(ctx, 0, 0, w, spotH, padding);
      this.drawMACD(ctx, 0, spotH + gap, w, macdH, padding);
      this.drawCrosshair(ctx, padding);
    }

    drawCandles(ctx, startX, startY, w, h, padding) {
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.top - padding.bottom;
      const plotX = startX + padding.left;
      const plotY = startY + padding.top;

      let min = Infinity, max = -Infinity;
      this.spots.forEach(d => {
        if (d.low < min) min = d.low;
        if (d.high > max) max = d.high;
      });
      const range = max - min || 1;
      min -= range * 0.05;
      max += range * 0.05;

      ctx.strokeStyle = this.theme.grid;
      ctx.fillStyle = this.theme.text;
      ctx.font = '10px var(--font-mono)';
      ctx.textAlign = 'left';

      // Y-Axis for Candles
      for (let i = 0; i <= 4; i++) {
        const gy = plotY + (plotH / 4) * i;
        const val = max - ((max - min) / 4) * i;
        
        ctx.beginPath();
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.stroke();
        ctx.fillText(val.toFixed(1), plotX + plotW + 8, gy + 3);
      }

      // X-Axis Time Labels & Vertical Grid
      ctx.textAlign = 'center';
      for (let i = 0; i < this.spots.length; i++) {
        const timeStr = this.formatTime(this.spots[i].timestamp);
        // Draw label every ~30 mins
        if (timeStr.endsWith('00') || timeStr.endsWith('30')) {
          const cx = plotX + (i / (this.spots.length - 1)) * plotW;
          
          // Vertical Grid line extending down through MACD
          ctx.beginPath();
          ctx.moveTo(cx, plotY);
          ctx.lineTo(cx, this.height - padding.bottom);
          ctx.stroke();

          ctx.fillText(timeStr, cx, this.height - 5);
        }
      }

      // Candlesticks
      const candleW = Math.max(1, (plotW / this.spots.length) * 0.6);
      this.spots.forEach((d, i) => {
        const cx = plotX + (i / (this.spots.length - 1)) * plotW;
        const oY = plotY + plotH - ((d.open - min) / (max - min)) * plotH;
        const cY = plotY + plotH - ((d.close - min) / (max - min)) * plotH;
        const hY = plotY + plotH - ((d.high - min) / (max - min)) * plotH;
        const lY = plotY + plotH - ((d.low - min) / (max - min)) * plotH;

        const isBull = d.close >= d.open;
        ctx.fillStyle = isBull ? this.theme.buy : this.theme.sell;
        ctx.strokeStyle = ctx.fillStyle;

        ctx.beginPath();
        ctx.moveTo(cx, hY);
        ctx.lineTo(cx, lY);
        ctx.stroke();

        const bodyTop = Math.min(oY, cY);
        const bodyHeight = Math.max(Math.abs(oY - cY), 1);
        ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyHeight);
      });
    }

    drawMACD(ctx, startX, startY, w, h, padding) {
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.bottom;
      const plotX = startX + padding.left;
      const plotY = startY;

      if (this.macd.length === 0) return;

      // Find max absolute value to center zero perfectly
      let maxAbs = 0;
      this.macd.forEach(d => {
        maxAbs = Math.max(maxAbs, Math.abs(d.value), Math.abs(d.signal), Math.abs(d.hist));
      });
      const max = maxAbs * 1.1 || 1;
      const min = -max;

      ctx.strokeStyle = this.theme.grid;
      ctx.fillStyle = this.theme.text;
      ctx.font = '10px var(--font-mono)';
      ctx.textAlign = 'left';

      // Y-Axis for MACD (Upper, Zero, Lower)
      [max, 0, min].forEach((val, i) => {
        const gy = plotY + (plotH / 2) * i;
        ctx.beginPath();
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.stroke();
        
        if (val !== 0) ctx.fillText(val.toFixed(2), plotX + plotW + 8, gy + 3);
        else ctx.fillText("0.00", plotX + plotW + 8, gy + 3);
      });

      const zeroY = plotY + (plotH / 2);
      const barW = Math.max(1, (plotW / this.macd.length) * 0.5);

      // 1. Draw Histogram
      this.macd.forEach((d, i) => {
        const cx = plotX + (i / (this.macd.length - 1)) * plotW;
        const histH = (Math.abs(d.hist) / max) * (plotH / 2);
        
        // Slightly transparent bars for aesthetics
        ctx.fillStyle = d.hist >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
        
        if (d.hist >= 0) {
          ctx.fillRect(cx - barW / 2, zeroY - histH, barW, histH);
        } else {
          ctx.fillRect(cx - barW / 2, zeroY, barW, histH);
        }
      });

      // 2. Draw MACD Line
      ctx.strokeStyle = this.theme.macdLine;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.macd.forEach((d, i) => {
        const cx = plotX + (i / (this.macd.length - 1)) * plotW;
        const cy = plotY + plotH - ((d.value - min) / (max - min)) * plotH;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      // 3. Draw Signal Line
      ctx.strokeStyle = this.theme.signalLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      this.macd.forEach((d, i) => {
        const cx = plotX + (i / (this.macd.length - 1)) * plotW;
        const cy = plotY + plotH - ((d.signal - min) / (max - min)) * plotH;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }

    drawCrosshair(ctx, padding) {
      if (!this.crosshair) return;

      const idx = this.crosshair.index;
      const spot = this.spots[idx];
      const macd = this.macd[idx];
      if (!spot) return;

      ctx.strokeStyle = this.theme.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(this.crosshair.x, padding.top);
      ctx.lineTo(this.crosshair.x, this.height - padding.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding.left, this.crosshair.y);
      ctx.lineTo(this.width - padding.right, this.crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Legend Tooltip
      const time = this.formatTime(spot.timestamp);
      let legendText = `Time: ${time} | O: ${spot.open.toFixed(1)}  H: ${spot.high.toFixed(1)}  L: ${spot.low.toFixed(1)}  C: ${spot.close.toFixed(1)}`;
      
      if (macd) {
        legendText += `  ||  MACD: ${macd.value.toFixed(2)}  Sig: ${macd.signal.toFixed(2)}  Hist: ${macd.hist.toFixed(2)}`;
      }
      
      ctx.font = '600 11px var(--font-mono)';
      const textWidth = ctx.measureText(legendText).width;
      
      ctx.fillStyle = this.theme.tooltipBg;
      ctx.fillRect(padding.left + 5, padding.top - 15, textWidth + 20, 24);
      
      ctx.strokeStyle = this.theme.grid;
      ctx.strokeRect(padding.left + 5, padding.top - 15, textWidth + 20, 24);
      
      ctx.fillStyle = this.theme.textDark;
      ctx.textAlign = 'left';
      ctx.fillText(legendText, padding.left + 15, padding.top + 1);
    }
  }

  window.TradingChart = TradingChart;
})();
