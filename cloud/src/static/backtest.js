// cloud/src/static/backtest.js

let equityChartInstance = null;

document.getElementById('run-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.innerText = "Simulating...";
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/run-backtest', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // Assuming you use the same basic auth as your dashboard
        'Authorization': 'Basic dmRpbmVzaHByYWJ1OkhlYWx0aHl3ZWFsdGgwMDcj' 
      },
      body: JSON.stringify({ days: 30 })
    });

    const data = await res.json();
    
    if (data.error) {
      alert("Backtest Failed: " + data.error);
      return;
    }

    // 1. Update Scorecards
    const pnlEl = document.getElementById('bt-pnl');
    pnlEl.innerText = `₹${data.totalPnL.toLocaleString('en-IN', {minimumFractionDigits: 2})}`;
    pnlEl.className = `text-2xl font-bold font-mono ${data.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`;
    
    document.getElementById('bt-winrate').innerText = `${data.winRate.toFixed(2)}%`;
    document.getElementById('bt-trades').innerText = data.totalTrades;
    document.getElementById('bt-drawdown').innerText = `₹${data.maxDrawdown.toLocaleString('en-IN', {minimumFractionDigits: 2})}`;

    // 2. Render Equity Curve
    const labels = data.trades.slice().reverse().map((t, index) => `Trade ${index + 1}`);
    const cumulativeData = data.trades.slice().reverse().map(t => t.cumulative);
    
    const ctx = document.getElementById('equityChart').getContext('2d');
    
    if (equityChartInstance) {
      equityChartInstance.destroy();
    }

    equityChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Cumulative PnL',
          data: cumulativeData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.1,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { display: false }, grid: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // 3. Render Table
    const tbody = document.getElementById('bt-table-body');
    tbody.innerHTML = '';

    data.trades.forEach(trade => {
      const isWin = trade.pnl >= 0;
      const typeColor = trade.type === 'CE' ? 'text-green-400' : 'text-red-400';
      const pnlColor = isWin ? 'text-green-400' : 'text-red-400';
      
      const tr = document.createElement('tr');
      tr.className = "border-b border-gray-800 hover:bg-gray-800 transition text-sm";
      tr.innerHTML = `
        <td class="p-2 text-gray-300 font-mono text-xs">${new Date(trade.entryTime).toLocaleString()}</td>
        <td class="p-2 font-bold ${typeColor}">${trade.type}</td>
        <td class="p-2 text-gray-300">${trade.entrySpot}</td>
        <td class="p-2 text-gray-300">${trade.exitSpot}</td>
        <td class="p-2 text-gray-400 text-xs">${trade.reason}</td>
        <td class="p-2 text-right font-mono font-bold ${pnlColor}">₹${trade.pnl.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
    alert("Network error running simulation.");
  } finally {
    btn.innerText = "Run 30-Day Simulation";
    btn.disabled = false;
  }
});
