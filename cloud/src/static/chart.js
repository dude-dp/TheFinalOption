// ============================================
// HTML5 Canvas Chart — Professional OHLC + MACD
// Client-side rendering with Crosshairs & Time Axis
// ============================================

(function () {
  'use strict';

  class TradingChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.spots = [];
      this.macd = [];
      this.dpr = window.devicePixelRatio || 1;
      this.crosshair = null;

      // Extract colors dynamically from your CSS variables
      const style = getComputedStyle(document.body);
      this.theme = {
        bg: style.getPropertyValue('--canvas-bg').trim() || '#f6f8fa',
        grid: style.getPropertyValue('--border').trim() || 'rgba(15, 23, 42, 0.06)',
        text: style.getPropertyValue('--text-muted').trim() || '#64748b',
        textDark: style.getPropertyValue('--text-primary').trim() || '#0f172a',
        buy: style.getPropertyValue('--accent-buy').trim() || '#059669',
        sell: style.getPropertyValue('--accent-sell').trim() || '#dc2626',
        macdLine: style.getPropertyValue('--accent-blue').trim() || '#4f46e5',
        crosshair: 'rgba(15, 23, 42, 0.2)'
      };

      this.resize();
      window.addEventListener('resize', () => this.resize());
      
      // Interactivity Events
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.canvas.addEventListener('mouseleave', () => {
        this.crosshair = null;
        this.draw();
      });
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = 350 * this.dpr; // Increased height slightly for breathing room
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = '350px';
      this.ctx.scale(this.dpr, this.dpr);
      this.width = rect.width;
      this.height = 350;
      this.draw();
    }

    updateData(spots, macd) {
      this.spots = spots || [];
      this.macd = macd || [];
      this.draw();
    }

    formatTime(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      // Format to HH:MM IST
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    handleMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.spots.length === 0) return;

      const padding = { left: 10, right: 60, top: 20, bottom: 20 };
      const plotW = this.width - padding.left - padding.right;
      
      // Find closest data point based on X coordinate
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
      
      // Panel dimensions
      const gap = h * 0.05;
      const spotH = h * 0.60;
      const macdH = h * 0.30;
      const padding = { left: 10, right: 60, top: 20, bottom: 20 };

      // Clear Canvas
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, w, h);

      if (this.spots.length < 2) {
        ctx.fillStyle = this.theme.text;
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting market data...', w / 2, h / 2);
        return;
      }

      // 1. Draw Candlesticks
      this.drawCandles(ctx, 0, 0, w, spotH, padding);

      // 2. Draw MACD
      this.drawMACD(ctx, 0, spotH + gap, w, macdH, padding);

      // 3. Draw Crosshair & Legend
      this.drawCrosshair(ctx, spotH, spotH + gap, macdH, padding);
    }

    drawCandles(ctx, startX, startY, w, h, padding) {
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.top - padding.bottom;
      const plotX = startX + padding.left;
      const plotY = startY + padding.top;

      // Find Min/Max for Y-Axis
      let min = Infinity, max = -Infinity;
      this.spots.forEach(d => {
        if (d.low < min) min = d.low;
        if (d.high > max) max = d.high;
      });
      const range = max - min || 1;
      min -= range * 0.05;
      max += range * 0.05;

      // Draw Grid & Y-Axis Labels
      ctx.strokeStyle = this.theme.grid;
      ctx.lineWidth = 1;
      ctx.fillStyle = this.theme.text;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';

      for (let i = 0; i <= 4; i++) {
        const gy = plotY + (plotH / 4) * i;
        const val = max - ((max - min) / 4) * i;
        
        ctx.beginPath();
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.stroke();
        
        ctx.fillText(val.toFixed(2), plotX + plotW + 5, gy + 3);
      }

      // Draw X-Axis Time Labels (Every ~30 mins)
      ctx.textAlign = 'center';
      for (let i = 0; i < this.spots.length; i++) {
        const timeStr = this.formatTime(this.spots[i].timestamp);
        if (timeStr.endsWith('00') || timeStr.endsWith('30')) {
          const cx = plotX + (i / (this.spots.length - 1)) * plotW;
          ctx.fillText(timeStr, cx, plotY + plotH + 15);
        }
      }

      // Draw Candlesticks
      const candleW = Math.max(1, (plotW / this.spots.length) * 0.7);

      this.spots.forEach((d, i) => {
        const cx = plotX + (i / (this.spots.length - 1)) * plotW;
        const oY = plotY + plotH - ((d.open - min) / (max - min)) * plotH;
        const cY = plotY + plotH - ((d.close - min) / (max - min)) * plotH;
        const hY = plotY + plotH - ((d.high - min) / (max - min)) * plotH;
        const lY = plotY + plotH - ((d.low - min) / (max - min)) * plotH;

        const isBull = d.close >= d.open;
        ctx.fillStyle = isBull ? this.theme.buy : this.theme.sell;
        ctx.strokeStyle = ctx.fillStyle;

        // Draw Wick
        ctx.beginPath();
        ctx.moveTo(cx, hY);
        ctx.lineTo(cx, lY);
        ctx.stroke();

        // Draw Body
        const bodyTop = Math.min(oY, cY);
        const bodyHeight = Math.max(Math.abs(oY - cY), 1); // Minimum 1px height
        ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyHeight);
      });
    }

    drawMACD(ctx, startX, startY, w, h, padding) {
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.bottom; // No top padding for MACD
      const plotX = startX + padding.left;
      const plotY = startY;

      if (this.macd.length === 0) return;

      const values = this.macd.map(d => d.value);
      let min = Math.min(...values);
      let max = Math.max(...values);
      
      // Ensure zero is visually centered if possible
      const absMax = Math.max(Math.abs(min), Math.abs(max));
      max = absMax * 1.1;
      min = -absMax * 1.1;

      // Draw Zero Line
      const zeroY = plotY + plotH - ((0 - min) / (max - min)) * plotH;
      ctx.strokeStyle = this.theme.text;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(plotX, zeroY);
      ctx.lineTo(plotX + plotW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw MACD Line
      ctx.strokeStyle = this.theme.macdLine;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      for (let i = 0; i < this.macd.length; i++) {
        const cx = plotX + (i / (this.macd.length - 1)) * plotW;
        const cy = plotY + plotH - ((this.macd[i].value - min) / (max - min)) * plotH;
        
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      
      // Draw Histogram representation (coloring the line under/over zero)
      for (let i = 1; i < this.macd.length; i++) {
         const prev = this.macd[i-1].value;
         const curr = this.macd[i].value;
         
         // Mark zero crossovers clearly
         if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
            const cx = plotX + (i / (this.macd.length - 1)) * plotW;
            const cy = plotY + plotH - ((curr - min) / (max - min)) * plotH;
            
            ctx.fillStyle = curr > 0 ? this.theme.buy : this.theme.sell;
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();
         }
      }
    }

    drawCrosshair(ctx, spotH, macdStartY, macdH, padding) {
      if (!this.crosshair) return;

      const idx = this.crosshair.index;
      const spot = this.spots[idx];
      const macd = this.macd[idx];
      if (!spot) return;

      // Draw Vertical & Horizontal Lines
      ctx.strokeStyle = this.theme.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Vertical Line
      ctx.beginPath();
      ctx.moveTo(this.crosshair.x, padding.top);
      ctx.lineTo(this.crosshair.x, this.height - padding.bottom);
      ctx.stroke();

      // Horizontal Line
      ctx.beginPath();
      ctx.moveTo(padding.left, this.crosshair.y);
      ctx.lineTo(this.width - padding.right, this.crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Legend Tooltip
      const time = this.formatTime(spot.timestamp);
      const isBull = spot.close >= spot.open;
      const color = isBull ? this.theme.buy : this.theme.sell;
      
      const legendText = `Time: ${time}  O: ${spot.open.toFixed(2)}  H: ${spot.high.toFixed(2)}  L: ${spot.low.toFixed(2)}  C: ${spot.close.toFixed(2)}  |  MACD: ${macd ? macd.value.toFixed(4) : '--'}`;
      
      ctx.font = '600 11px Inter, sans-serif';
      const textWidth = ctx.measureText(legendText).width;
      
      // Tooltip Background
      ctx.fillStyle = this.theme.bg;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(padding.left + 5, padding.top - 15, textWidth + 20, 24);
      ctx.globalAlpha = 1.0;
      
      // Tooltip Border & Text
      ctx.strokeStyle = this.theme.grid;
      ctx.strokeRect(padding.left + 5, padding.top - 15, textWidth + 20, 24);
      
      ctx.fillStyle = this.theme.textDark;
      ctx.textAlign = 'left';
      ctx.fillText(legendText, padding.left + 15, padding.top + 1);
    }
  }

  // Expose globally
  window.TradingChart = TradingChart;
})();
