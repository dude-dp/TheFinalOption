// ============================================
// HTML5 Canvas Chart — NIFTY Spot + MACD
// Client-side rendering for real-time data
// ============================================

(function () {
  'use strict';

  const COLORS = {
    bg: 'transparent',
    grid: 'rgba(15, 23, 42, 0.04)',
    spot: '#4f46e5',
    macd: '#0f172a',
    zeroline: '#64748b',
    crossBuy: '#059669',
    crossSell: '#dc2626',
    text: '#475569',
  };

  class TradingChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.spotData = [];
      this.macdData = [];
      this.dpr = window.devicePixelRatio || 1;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = 300 * this.dpr;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = '300px';
      this.ctx.scale(this.dpr, this.dpr);
      this.width = rect.width;
      this.height = 300;
      this.draw();
    }

    updateData(spots, macd) {
      this.spotData = spots || [];
      this.macdData = macd || [];
      this.draw();
    }

    draw() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const spotH = h * 0.55;
      const macdH = h * 0.35;
      const gap = h * 0.1;

      // Dynamically fetch theme colors from CSS variables
      const rootStyles = getComputedStyle(document.documentElement);
      COLORS.grid = rootStyles.getPropertyValue('--border').trim() || 'rgba(15, 23, 42, 0.06)';
      COLORS.text = rootStyles.getPropertyValue('--text-muted').trim() || '#64748b';
      COLORS.crossBuy = rootStyles.getPropertyValue('--accent-buy').trim() || '#059669';
      COLORS.crossSell = rootStyles.getPropertyValue('--accent-sell').trim() || '#dc2626';
      COLORS.spot = rootStyles.getPropertyValue('--accent-blue').trim() || '#4f46e5';
      COLORS.macd = rootStyles.getPropertyValue('--text-primary').trim() || '#0f172a';
      COLORS.zeroline = rootStyles.getPropertyValue('--text-muted').trim() || '#64748b';

      // Clear
      ctx.clearRect(0, 0, w, h);

      if (this.spotData.length < 2) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting market data...', w / 2, h / 2);
        return;
      }

      // --- SPOT CHART (top) ---
      this.drawPanel(ctx, 0, 0, w, spotH, this.spotData, COLORS.spot, 'NIFTY SPOT', true);

      // --- MACD CHART (bottom) ---
      this.drawPanel(ctx, 0, spotH + gap, w, macdH, this.macdData, COLORS.macd, 'MACD', false);
    }

    drawPanel(ctx, x, y, w, h, data, color, label, isSpot) {
      const padding = { left: 60, right: 20, top: 24, bottom: 20 };
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.top - padding.bottom;
      const plotX = x + padding.left;
      const plotY = y + padding.top;

      // Values
      const values = data.map(d => d.value);
      let min = Math.min(...values);
      let max = Math.max(...values);
      const range = max - min || 1;
      min -= range * 0.05;
      max += range * 0.05;

      // Panel label
      ctx.fillStyle = COLORS.text;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, plotX, y + 14);

      // Current value
      const currentVal = values[values.length - 1];
      ctx.font = '700 12px JetBrains Mono, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(currentVal.toFixed(2), x + w - padding.right, y + 14);

      // Grid lines
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      const gridCount = 4;
      for (let i = 0; i <= gridCount; i++) {
        const gy = plotY + (plotH / gridCount) * i;
        ctx.beginPath();
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.stroke();

        // Y-axis labels
        const val = max - ((max - min) / gridCount) * i;
        ctx.fillStyle = COLORS.text;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(isSpot ? 0 : 2), plotX - 8, gy + 4);
      }

      // Zero line for MACD
      if (!isSpot && min < 0 && max > 0) {
        const zeroY = plotY + plotH - ((0 - min) / (max - min)) * plotH;
        ctx.strokeStyle = COLORS.zeroline;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(plotX, zeroY);
        ctx.lineTo(plotX + plotW, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Data line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const px = plotX + (i / (data.length - 1)) * plotW;
        const py = plotY + plotH - ((values[i] - min) / (max - min)) * plotH;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Gradient fill under line
      const gradient = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
      gradient.addColorStop(0, color.replace(')', ', 0.15)').replace('rgb', 'rgba'));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.lineTo(plotX + plotW, plotY + plotH);
      ctx.lineTo(plotX, plotY + plotH);
      ctx.closePath();
      ctx.fill();

      // Crossover markers for MACD
      if (!isSpot) {
        for (let i = 1; i < data.length; i++) {
          const prev = values[i - 1];
          const curr = values[i];
          if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
            const px = plotX + (i / (data.length - 1)) * plotW;
            const py = plotY + plotH - ((curr - min) / (max - min)) * plotH;
            const isBuy = prev <= 0 && curr > 0;

            ctx.fillStyle = isBuy ? COLORS.crossBuy : COLORS.crossSell;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fillStyle = isBuy
              ? 'rgba(57, 255, 20, 0.2)'
              : 'rgba(255, 7, 58, 0.2)';
            ctx.fill();
          }
        }
      }
    }
  }

  // Expose globally
  window.TradingChart = TradingChart;
})();
