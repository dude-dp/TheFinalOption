# ⚡ TheFinalOption

**Fully automated NIFTY Index Options trading bot** using MACD zero-line crossover strategy.

Hybrid architecture: **Cloud Brain** (Cloudflare Workers) + **Local Muscle** (Node.js daemon on your whitelisted IP).

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│              ☁️  CLOUD BRAIN                      │
│         (Cloudflare Workers Free Tier)            │
│                                                   │
│  ⏰ Cron Worker ──► MACD Analysis ──► Signal      │
│  🔌 Hono API   ──► Poll / Confirm / Dashboard    │
│  ⚡ KV          ──► Bot State + Pending Orders    │
│  🗄️  D1         ──► Trade Logs + Telemetry        │
│  🤖 Workers AI  ──► EOD Summary (Llama 3)         │
└────────────────────┬─────────────────────────────┘
                     │ HTTPS (1.5s polling)
┌────────────────────┴─────────────────────────────┐
│              🏠 LOCAL MUSCLE                      │
│         (Chennai Machine / Static IP)             │
│                                                   │
│  🦾 Node.js Daemon ──► Upstox v3 Order Execution │
│  📊 PM2 Managed    ──► Auto-restart + Logging     │
└──────────────────────────────────────────────────┘
```

## Strategy

| Parameter | Value |
|-----------|-------|
| Instrument | NIFTY 50 Index Options (CE & PE) |
| Timeframe | 1-minute candles |
| Indicator | MACD (12, 26) zero-line crossover |
| Buy CE | MACD crosses above 0 |
| Buy PE | MACD crosses below 0 |
| Strike | ATM (rounded to nearest 50) |
| Lot Size | Dynamic (fetched from instrument master) |
| Risk | Configurable (default 20% of margin) |
| Expiry | Nearest weekly (rolls on Thursdays) |
| Square-off | Auto at 3:15 PM IST |

## Quick Start

### 1. Cloud Worker Setup

```bash
cd cloud
npm install

# Create D1 database
npx wrangler d1 create thefinaloption-db

# Create KV namespace
npx wrangler kv namespace create TRADING_KV

# Update wrangler.jsonc with the IDs from above commands

# Initialize database schema
npm run db:init

# Set secrets
npx wrangler secret put UPSTOX_CLIENT_SECRET
npx wrangler secret put POLL_SECRET

# Deploy
npm run deploy
```

### 2. Local Daemon Setup

```bash
cd local-daemon
npm install

# Configure
cp .env.example .env
# Edit .env with your Worker URL and secrets

# Test (dry run)
DRY_RUN=true npm run dev

# Production (via PM2)
npm run pm2:start
```

### 3. Authenticate Upstox

Open the dashboard and click **"🔑 Re-Authenticate Upstox"**. This opens the OAuth flow — login with your Upstox credentials. The access token is stored in KV (expires daily).

## Dashboard

Access at your Worker URL. Features:
- **Control Matrix**: Start/Stop bot, Emergency Square-Off
- **Position Tracker**: Active trade details + P&L
- **NIFTY + MACD Chart**: Real-time canvas visualization
- **Trade Log**: Complete order history
- **System Console**: Live telemetry stream
- **AI Summary**: End-of-day analysis via Workers AI

## Safety Features

- 🔒 Position lock prevents duplicate orders
- ⏰ Auto square-off at 3:15 PM IST
- 🚨 Emergency halt with double-click confirmation
- 📊 Dynamic lot sizing with risk cap (default 20%)
- 🔄 SELL-before-BUY ordering for position reversals
- ⏱️ 5-minute TTL on pending orders in KV
- 🛡️ Exponential backoff on daemon network errors
- 📝 Paper/dry-run mode for testing

## Project Structure

```
TheFinalOption/
├── cloud/                    # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── cron.ts           # Trading brain
│   │   ├── queue.ts          # Queue consumer
│   │   ├── lib/              # Core logic
│   │   │   ├── macd.ts       # MACD calculations
│   │   │   ├── strike.ts     # Strike selection
│   │   │   ├── lot-sizing.ts # Position sizing
│   │   │   ├── upstox.ts     # API client
│   │   │   ├── time.ts       # IST utilities
│   │   │   └── types.ts      # TypeScript types
│   │   ├── routes/
│   │   │   ├── api.ts        # HTTP endpoints
│   │   │   └── dashboard.tsx # Frontend
│   │   └── static/
│   │       ├── styles.css    # Design system
│   │       ├── chart.js      # Canvas chart
│   │       └── dashboard.js  # Client JS
│   ├── schema.sql            # D1 schema
│   └── wrangler.jsonc        # Worker config
│
├── local-daemon/             # Local execution
│   ├── src/
│   │   ├── index.ts          # Polling loop
│   │   ├── executor.ts       # Order execution
│   │   └── logger.ts         # File logger
│   ├── ecosystem.config.cjs  # PM2 config
│   └── .env.example
│
└── README.md
```

## Free Tier Budget

| Resource | Limit | Daily Usage (est.) |
|----------|-------|--------------------|
| Worker Requests | 100K/day | ~1,500 (cron + polls) |
| KV Reads | 100K/day | ~1,200 |
| KV Writes | 1,000/day | ~20 (signals only) |
| D1 Storage | 500MB | ~50KB/day growth |
| Queues Ops | 10K/day | ~50 |
| Workers AI | 10K neurons/day | ~2K (EOD summary) |

---

> ⚠️ **Disclaimer**: This software is for educational purposes. Trading in derivatives involves substantial risk. Always paper-test before live deployment. The authors are not liable for any financial losses.
