// cloud/src/routes/backtest.tsx
import { jsx } from 'hono/jsx';

export const BacktestPage = () => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Backtest Engine | TheFinalOption</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>{`
        body { background-color: #121212; color: #e0e0e0; font-family: 'Inter', sans-serif; }
        .card { background-color: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 8px; }
      `}</style>
    </head>
    <body class="p-6">
      
      {/* Header */}
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-white">Quantum Backtest Engine</h1>
          <p class="text-sm text-gray-400">Simulate strategy performance over historical D1 data.</p>
        </div>
        <div class="flex gap-4">
          <a href="/" class="px-4 py-2 border border-gray-600 rounded text-gray-300 hover:bg-gray-800 transition">Back to Live Dashboard</a>
          <button id="run-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow-lg transition">Run 30-Day Simulation</button>
        </div>
      </div>

      {/* Scorecards */}
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="card p-4">
          <h4 class="text-xs text-gray-500 uppercase tracking-widest mb-1">Total PnL</h4>
          <span id="bt-pnl" class="text-2xl font-bold font-mono text-white">₹0.00</span>
        </div>
        <div class="card p-4">
          <h4 class="text-xs text-gray-500 uppercase tracking-widest mb-1">Win Rate</h4>
          <span id="bt-winrate" class="text-2xl font-bold font-mono text-white">0.00%</span>
        </div>
        <div class="card p-4">
          <h4 class="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Trades</h4>
          <span id="bt-trades" class="text-2xl font-bold font-mono text-white">0</span>
        </div>
        <div class="card p-4">
          <h4 class="text-xs text-gray-500 uppercase tracking-widest mb-1">Max Drawdown</h4>
          <span id="bt-drawdown" class="text-2xl font-bold font-mono text-red-400">₹0.00</span>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div class="card p-4 mb-6">
        <h3 class="text-lg font-bold text-white mb-4">Simulated Equity Curve</h3>
        <div style="position: relative; height:300px; width:100%">
          <canvas id="equityChart"></canvas>
        </div>
      </div>

      {/* Trade Ledger */}
      <div class="card p-4">
        <h3 class="text-lg font-bold text-white mb-4">Simulation Ledger</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs uppercase text-gray-400">
                <th class="p-2">Entry Time</th>
                <th class="p-2">Type</th>
                <th class="p-2">Entry Spot</th>
                <th class="p-2">Exit Spot</th>
                <th class="p-2">Exit Reason</th>
                <th class="p-2 text-right">PnL</th>
              </tr>
            </thead>
            <tbody id="bt-table-body">
              <tr><td colSpan={6} class="p-4 text-center text-gray-500">Run a simulation to view trades.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <script src="/static/backtest.js"></script>
    </body>
  </html>
);
