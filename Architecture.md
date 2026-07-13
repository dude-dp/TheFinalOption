# ⚡ TheFinalOption: System Architecture

## Overview
TheFinalOption is an automated NIFTY Index Options trading bot utilizing a MACD (12, 26) zero-line crossover strategy. The system is actively transitioning from a serverless-heavy architecture to a highly reliable, stateful **EC2 + Supabase** monolith. 

The primary goal of this architecture is to strictly isolate responsibilities: **Cloudflare acts exclusively as the UI, Auth, and Control plane**, while **EC2 handles 100% of the exchange interaction, market data, and execution logic**.

---

## 1. Current Architecture (Phase 1 Migration Complete)

### 1.1 Storage Layer (Supabase PostgreSQL)
Supabase is now the unified source of truth, completely replacing Cloudflare D1.
* **`nifty_candles`**: Stores all 1-minute historical and live market data. Autonomously managed by the EC2 Data Engine.
* **`system_telemetry`**: Logs execution intent, system state, and manual overrides.
* **`order_ledger`**: Tracks the complete lifecycle of trades and PnL.
* **`bot_configuration`**: Dynamic settings controlled by the dashboard.

### 1.2 Data & Execution Engine (AWS EC2 - Node.js Daemon)
A persistent, PM2-managed Node.js process acting as the system's "Muscle" and "Memory."
* **Autonomous Data Engine (`data-engine.ts`)**: Self-healing data pipeline. It continuously patches missing historical candles via Upstox API and logs live 1-minute candle closes directly to Supabase.
* **Upstox WS Client (`ws-client.ts`)**: Maintains a continuous WebSocket connection for real-time tick aggregation.
* **Stealth Executor (`executor.ts` & `iceberg.ts`)**: Handles automated order slicing, dynamic lot sizing, and limit-order execution.
* **State Sync (`tracker.ts` & `broker-adapter.ts`)**: Synchronizes realized/unrealized PnL between the exchange and local memory.

### 1.3 Control Plane & UI (Cloudflare Workers)
The user-facing edge network. It no longer manages market data fetching.
* **Authentication**: Manages Upstox OAuth flow (`/api/auth/login`).
* **Dashboard API**: Serves UI requests by reading directly from Supabase (e.g., `/api/chart-data`, `/api/orders`).
* **Command Bridge**: Pushes user commands (Start/Stop, Manual Overrides) to EC2 via KV polling (Pending migration).
* **Cron triggers**: Currently still evaluates MACD signals (Pending migration).

---

## 2. Core Workflows (Current State)

### Data Pipeline (EC2 -> Supabase -> Cloudflare)
1. **Ingestion:** EC2 Daemon connects to Upstox and aggregates live ticks into 1-minute candles.
2. **Persistence:** EC2 Data Engine writes the closed candle directly to Supabase (`nifty_candles`). If the daemon reboots, the Auto-Healer patches missing candles automatically.
3. **Visualization:** Cloudflare Worker reads `nifty_candles` from Supabase and formats it for the frontend TradingView chart. **Cloudflare never touches the Upstox Data APIs.**

---

## 3. The Roadmap: Full EC2 Independence

To eliminate Cloudflare timeouts and network bridging failures, the remaining Upstox interactions in Cloudflare must be migrated to EC2.

### Phase 2: Migrate the "Brain" (Signal Generation) to EC2
* **Current:** Cloudflare Cron evaluates the MACD every minute and pushes an order to KV.
* **Target:** EC2 already aggregates the candles natively. The EC2 daemon will calculate the MACD in its own memory loop, trigger the signal, and execute the order instantly (sub-10ms latency). The Cloudflare Cron will be deleted.

### Phase 3: Replace KV Polling with Supabase Realtime
* **Current:** EC2 polls Cloudflare `/api/poll` every 1.5s to get the `UPSTOX_ACCESS_TOKEN`, Bot State, and Manual Orders.
* **Target:** Store the Access Token and Bot State in Supabase. EC2 will use **Supabase Realtime (Postgres LISTEN/NOTIFY)** to instantly receive state changes (e.g., User clicks "Start Bot" or "Manual Buy") without HTTP polling overhead.

### Phase 4: Shift UI Telemetry (LTP & Margin) to EC2
* **Current:** Cloudflare calls Upstox `getLTP` and `getFundsAndMargin` when the user opens the dashboard (`/api/status`).
* **Target:** EC2 will push current margin and active position LTP to a lightweight `live_status` Supabase table every second. Cloudflare will simply read this table to serve the dashboard, dropping Cloudflare's Upstox dependency to 0%.We update the Cloudflare /api/status route to just read that row from Supaba