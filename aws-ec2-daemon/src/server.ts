import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import * as fs from 'node:fs';
import * as path from 'node:path';

const app = new Hono();

app.use('/*', basicAuth({
  username: process.env.ADMIN_USER || 'dp',
  password: process.env.POLL_SECRET || 'Healthywealth007'
}));

// Strictly fetch EC2 Daemon logs
app.get('/api/logs/daemon', (c) => {
  const logPath = path.resolve('logs', 'daemon.log');
  if (!fs.existsSync(logPath)) return c.text('Log file empty or not initialized yet.');

  const fileStats = fs.statSync(logPath);
  const maxReadBytes = 200000; 
  const startPos = Math.max(0, fileStats.size - maxReadBytes);

  const buffer = Buffer.alloc(fileStats.size - startPos);
  const fd = fs.openSync(logPath, 'r');
  fs.readSync(fd, buffer, 0, buffer.length, startPos);
  fs.closeSync(fd);

  return c.text(buffer.toString('utf-8'));
});

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>MTF Screener - EC2 Terminal</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background-color: #301934; color: #e0d5e3; font-family: sans-serif; padding: 30px; }
        header { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
        h1 { color: #ffffff; font-size: 24px; font-weight: 600; }
        .badge { background: #00ff66; color: #1a081c; padding: 4px 8px; font-size: 12px; font-weight: bold; border-radius: 4px; }
        .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 24px; margin-bottom: 24px; }
        h2 { font-size: 18px; margin-bottom: 16px; color: #ffffff; }
        .btn { background: #8e44ad; color: #fff; border: none; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 4px; cursor: pointer; }
        .btn:hover { background: #9b59b6; }
        .btn-secondary { background: rgba(255,255,255,0.1); margin-left: 10px; }
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(26, 8, 28, 0.85); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: 0.3s; z-index: 1000; }
        .modal-overlay.active { opacity: 1; pointer-events: auto; }
        .modal { background: #251228; border: 1px solid rgba(255,255,255,0.15); width: 90%; max-width: 900px; height: 80vh; border-radius: 8px; display: flex; flex-direction: column; }
        .modal-header { padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; }
        .modal-body { flex: 1; background: #160718; padding: 20px; overflow-y: auto; font-family: monospace; font-size: 13px; color: #00ff66; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>MTF Screener Execution Plane</h1>
          <p style="font-size: 14px; color: #b5a4ba; margin-top: 4px;">Unified EC2 Standalone Deployment Instance</p>
        </div>
        <span class="badge">EC2 INSTANCE ACTIVE</span>
      </header>

      <div class="card">
        <h2>System Telemetry Logs</h2>
        <p style="font-size: 14px; margin-bottom: 20px; color: #b5a4ba;">Monitor the 6-worker concurrent MTF screener.</p>
        <button class="btn" onclick="openLogModal()">View Live System Logs</button>
      </div>

      <div class="modal-overlay" id="logModalOverlay">
        <div class="modal">
          <div class="modal-header">
            <h2>System Daemon Logs</h2>
            <button class="btn btn-secondary" onclick="closeLogModal()">Close Terminal</button>
          </div>
          <div class="modal-body" id="modalLogContent">Loading execution streams...</div>
        </div>
      </div>

      <script>
        let logInterval = null;
        function openLogModal() {
          document.getElementById('logModalOverlay').classList.add('active');
          fetchCurrentLogs();
          logInterval = setInterval(fetchCurrentLogs, 3000);
        }
        function closeLogModal() {
          document.getElementById('logModalOverlay').classList.remove('active');
          if(logInterval) clearInterval(logInterval);
        }
        async function fetchCurrentLogs() {
          const contentDiv = document.getElementById('modalLogContent');
          try {
            const res = await fetch('/api/logs/daemon');
            contentDiv.textContent = await res.text();
            contentDiv.scrollTop = contentDiv.scrollHeight;
          } catch(e) {
            contentDiv.textContent = "Error gathering execution logs.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

const port = Number(process.env.HEALTH_PORT) || 3847;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[MTF-SCREENER] Management Server listening on http://0.0.0.0:${info.port}`);
});
