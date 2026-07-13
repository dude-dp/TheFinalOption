# TheFinalOption: System Architecture

## Overview
TheFinalOption is an automated NIFTY Index Options trading bot utilizing a MACD (12, 26) zero-line crossover strategy. Currently, the system operates on a **Hybrid Architecture**, splitting responsibilities between a serverless "Cloud Brain" and a stateful "Local Execution Daemon". 

To reduce dependency on Cloudflare's serverless edge and prevent synchronization/timeout issues, the system is actively migrating toward a consolidated, stateful deployment on AWS EC2.

---

## 1. Current Hybrid Baseline

### 1.1 Cloud Brain (Cloudflare Edge)
The control plane and analytical engine, built on Cloudflare Workers and Hono.

* **Compute (Workers):** * API Gateway (`api.ts`) for frontend dashboard and daemon polling.
  * Cron triggers (`cron.ts`) operating every minute during IST market hours to evaluate MACD and emit signals.
* **Storage:**
  * **D1 (SQLite):** Persistent source of truth. Stores `system_telemetry`, `order_ledger`, `bot_configuration`, and AI `daily_summary`.
  * **KV:** Ultra-low-latency state management for bot status, ephemeral Upstox tokens, Option Chain caching, and 5-minute TTL pending orders.
* **Async Processing (Queues):** Fan-out architecture (`ORDER_QUEUE`) handling order state tracking, orphan sweeping, and Dead Letter Queue (DLQ) escalations.
* **Frontend:** Hono JSX rendering the control dashboard and backtest UIs.

### 1.2 Local Muscle (Node.js Execution Daemon)
A persistent, PM2-managed Node.js process designed for high-speed exchange interaction.

* **Upstox WS Client (`ws-client.ts`):** Maintains a continuous WebSocket connection for 1-minute candle aggregation and real-time Profit/Loss tracking.
* **Stealth Executor (`executor.ts` & `iceberg.ts`):** Handles automated order slicing, dynamic lot sizing (capped by risk config), and Level 2 Market Depth capture before limit execution.
* **Circuit Breakers (`index.ts`):** Auto-halts operations after 3 consecutive Upstox API failures or if crash-recovery detects severe mid-session drawdown (Shield Mode).
* **State Sync (`tracker.ts`):** Synchronizes realized/unrealized PnL between the exchange and the local daemon memory.

---

## 2. Core Workflows (Current State)

### Data & Execution Pipeline
1. **Ingestion:** The Local Daemon aggregates live tick data into 1-minute candles via Upstox WebSockets.
2. **Signal Generation:** The Cloud Worker (Cron) or Local Daemon evaluates the MACD (12, 26) against the zero-line.
3. **Synchronization:** The daemon maintains a dual-link to the Cloud: HTTP Watchdog polling (every 5s) and a Cloud WebSocket (`/api/ws`) for zero-latency execution commands.
4. **Execution:** Upon signal, the daemon executes "SELL-before-BUY" logic for position reversals, using Stealth Iceberg slicing to mask large orders.
5. **Confirmation:** Execution success, partial fills, or rejections are pushed back to the Cloud Worker to update the D1 `order_ledger`.

---

## 3. EC2 Target Architecture (Migration Path)

The transition to EC2 will eliminate the HTTP polling overhead, Worker CPU time limits, and WebSocket bridging complexities by unifying the Brain and Muscle into a single environment. 

### Phase 1: Database Consolidation (Supabase)
D1 is native to Cloudflare and cannot be accessed locally with zero latency. Given the existing `@supabase/supabase-js` dependencies and API keys already present in the codebase, the storage layer will migrate entirely to **Supabase (PostgreSQL)**.
* Replace D1 `order_ledger` and `system_telemetry` with Supabase tables.
* Utilize Supabase Realtime for dashboard UI updates instead of polling Cloudflare endpoints.

### Phase 2: Unifying Compute (EC2 Monolith)
* **Single Node Process:** Merge the Hono API, Cron scheduling, and the Upstox execution engine into a single PM2-managed application on EC2.
* **In-Memory Analytics:** MACD calculation and signal generation will happen directly in the daemon's memory footprint, dropping signal-to-execution latency to sub-10ms.
* **Network Isolation:** EC2 allows strict Elastic IP whitelisting for Upstox API security, without worrying about Cloudflare IP pool rotations.

### Phase 3: State & Queue Replacement
* **Drop Cloudflare KV:** Replace KV entirely. Option chain caching and ephemeral Upstox tokens will be stored in a local **Redis** container on the EC2 instance (or ElastiCache), ensuring sub-millisecond read times.
* **Drop Cloudflare Queues:** Replace the `ORDER_QUEUE` and DLQ mechanisms with **BullMQ** (backed by the local Redis instance) to handle order tracking, orphan sweeping, and retry logic natively within the EC2 environment.

## 4. Security & Failsafes (Preserved in Migration)
* **Crash Recovery:** Daemon reconstructs open positions, realized PnL, and unrealized PnL directly from Upstox on boot before unpausing trading.
* **Watchdog Service:** PM2 will handle auto-restarts on the EC2 instance, with a dedicated health endpoint (`/health` on port 3847) monitored by a local script.