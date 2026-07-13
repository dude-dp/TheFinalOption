# TheFinalOption: Operational Guide & Cheat Sheet

**TheFinalOption** is a hybrid trading bot architecture that separates the analytical "brain" (Cloudflare Workers, D1, KV, Queues) from the execution "muscle" (a local Node.js daemon running on an IP-whitelisted server).

---

## 🏗️ Architecture at a Glance

1. **Cloud Worker (`cloud/`)**: Contains the API, Dashboard, Trading logic, Cron triggers, and Database (D1). It computes signals and creates orders.
2. **Local Daemon (`local-daemon/`)**: Polls the Cloud Worker every 1.5s. When an order is generated, the daemon executes it securely via the Upstox API and reports the execution status back to the cloud.

---

## 🛠️ Essential NPM Commands (Run from root folder)

| Command | Description |
|---|---|
| `npm run dev:cloud` | Runs the Cloudflare Worker locally for testing. |
| `npm run deploy:cloud` | Builds and deploys the Cloudflare Worker to production. |
| `npm run dev:daemon` | Runs the local daemon in foreground mode (great for debugging). |
| `npm run daemon:pm2` | Starts/Restarts the local daemon in the background using PM2. |
| `npm run db:init` | Applies `schema.sql` to your production D1 Database. |
| `npm run db:init:local`| Applies `schema.sql` to your local testing D1 Database. |

---

## 🧠 Managing the Local Daemon (PM2)

Since the local execution daemon runs constantly, it is managed by **PM2** (Process Manager). You can use `npx pm2` to control it from the `local-daemon` folder.

* **View Daemon Logs in Real-time:**
  ```bash
  cd local-daemon && npx pm2 logs thefinaloption-daemon
  ```
  *(Press `Ctrl+C` to exit the log view)*

* **Check Daemon Status:**
  ```bash
  cd local-daemon && npx pm2 status
  ```

* **Restart the Daemon:**
  ```bash
  cd local-daemon && npx pm2 restart thefinaloption-daemon
  ```

* **Stop the Daemon completely:**
  ```bash
  cd local-daemon && npx pm2 stop thefinaloption-daemon
  ```

* **Local Logs Directory:**
  The daemon also writes persistent file logs in `local-daemon/logs/`.
  *View today's log:* `tail -f local-daemon/logs/daemon-$(date +%Y-%m-%d).log`

---

## ☁️ Managing Cloudflare (Wrangler)

If you need to update secrets or view remote logs, use Wrangler from the `cloud/` directory:

* **View live production logs (Tail):**
  ```bash
  cd cloud && npx wrangler tail
  ```

* **Add or Update a Secret (e.g. API Keys):**
  ```bash
  cd cloud && npx wrangler secret put SECRET_NAME
  ```
  *Required Secrets: `UPSTOX_CLIENT_SECRET`, `POLL_SECRET`*

* **Check your Database (D1):**
  ```bash
  # Execute a custom SQL query directly on production
  cd cloud && npx wrangler d1 execute thefinaloption-db --remote --command="SELECT * FROM order_ledger LIMIT 5;"
  ```

---

## 🎮 Dashboard Operations

Your dashboard is located at your Cloudflare Worker URL (e.g., `https://thefinaloption...workers.dev/`).

1. **Daily Authentication:**
   * Upstox tokens expire daily.
   * Every morning before market hours, go to the dashboard and click **Authenticate with Upstox**.
2. **Start / Stop Bot:**
   * **Start:** Enables the Cron trigger to compute MACD and place trades.
   * **Stop:** Pauses new trade generation. The daemon will continue polling silently.
3. **Emergency Halt:**
   * If something goes wrong, hit the **Emergency Square-Off** button. It will immediately place a reverse order for any active position and halt the bot.

---

## ⚙️ Configuration Cheatsheet

### Local Daemon (`local-daemon/.env`)
* `DRY_RUN=true|false`: If `true`, the daemon will receive orders from the cloud but will **not** send them to Upstox. It will just log them.
* `POLL_INTERVAL_MS=1500`: How often the daemon asks the cloud for new orders.
* `HEALTH_PORT=3847`: Local health-check server (Test via: `curl http://localhost:3847/health`)

### Cloud Configuration (`cloud/wrangler.jsonc`)
* `crons: ["*/1 3-10 * * 1-5"]`: Controls when the bot evaluates the market. Currently set to every minute from 3:00 to 10:59 UTC, Monday-Friday.
* `vars.UPSTOX_REDIRECT_URI`: Must exactly match the URL registered in your Upstox Developer Console (ending in `/oauth/callback`).




## start bot manually

curl -X POST -u vdineshprabu:Healthywealth007# -H "Content-Type: application/json" -d '{"action":"START"}' https://thefinaloption.thefinaloptionautomation.workers.dev/api/control