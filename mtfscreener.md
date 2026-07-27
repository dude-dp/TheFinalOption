# 📊 MTF Screener — Technical Reference

> **Module:** `aws-ec2-daemon/src/mtf-screener.ts`
> **Subsystem:** Dual-Timeframe Equity Screener
> **Trigger:** Scheduled cron + on-demand from UI
> **Storage:** Supabase PostgreSQL (`mtf_screened_stocks`, `mtf_instrument_master`, `system_controls`)

---

## 1. Overview

The MTF (Multi-Timeframe) Screener is an autonomous equity scanner that runs on the EC2 daemon. It evaluates every NSE stock approved by Upstox for MTF (Margin Trade Financing) and surfaces actionable swing trade setups by applying a two-gate confirmation model:

| Gate | Timeframe | Indicators |
|------|-----------|------------|
| **Gate 1 — Signal Detection** | 30-minute candles | MACD zero-line cross, RSI, EMA cross, Candlestick patterns |
| **Gate 2 — Conviction Check** | Daily candles | MACD alignment (above zero) |

Only stocks that pass **both gates** are written to the database and eligible for a Discord sniper alert.

---

## 2. Execution Architecture

### 2.1 Entry Points

```
index.ts
  └── startMTFTriggerListener()    ← polls Supabase system_controls every 3s
  └── cron('*/30 9-15 * * 1-5')   ← runs run15MinScreener() every 30 min (IST)
```

### 2.2 Concurrency Model — 6-Worker Pool

The screener deploys **6 concurrent async workers** that share a single ordered watchlist via an atomic index pointer. This is the same architecture as the AutoBot's candle fetcher, keeping total API throughput at **≤100 req/s** (well under Upstox's 150 req/s hard limit).

```
watchlist[0..N]
  │
  ├── Worker 0 ──┐
  ├── Worker 1   │  each worker grabs watchlist[currentIndex++]
  ├── Worker 2   │  atomically, then sleeps 60ms between stocks
  ├── Worker 3   │
  ├── Worker 4   │
  └── Worker 5 ──┘
```

**Rate math:** 6 workers × 60ms delay = 100 req/s peak → safe under 150 req/s limit.

---

## 3. Signal Detection Logic (Gate 1 — 30-Minute)

Source: `detect15mSignals()` in `aws-ec2-daemon/src/mtf-screener.ts` (L71–L172)

### 3.1 Minimum Data Requirement

```ts
if (closes.length < 35) return null; // Need at least 35 candles for EMA warmup
```

### 3.2 Computed Indicators

| Indicator | Params | Purpose |
|-----------|--------|---------|
| **MACD** | 12, 26, 9 EMA | Primary trend signal |
| **RSI** | 14-period | Momentum filter |
| **ADX** | 14-period | Trend strength |
| **ATR** | 14-period | Volatility + Stop Loss sizing |
| **VWAP Distance** | Intraday | Mean-reversion proximity |
| **RVOL** | Rolling average | Volume surge confirmation |
| **EMA 9 / EMA 21** | — | Golden cross detection |

### 3.3 The Gatekeeper — Primary Signal Conditions

A stock must satisfy **at least one** of these conditions to pass Gate 1:

#### Condition A — Classic Zero-Line Cross (`ZERO_LINE_CROSS`)

```ts
prevMacd <= 0 && currentMacd > 0
```

MACD line has just crossed from negative to positive territory. This is the **highest-priority** signal.

#### Condition B — Anticipatory Approach (`APPROACHING_ZERO`)

```ts
currentMacd < 0
  && currentMacd > prevMacd        // accelerating upward
  && prevMacd > prev2Macd          // three consecutive improvements
  && histogram > 0                 // histogram already bullish
  && (currentMacd - prevMacd) > 0.5  // minimum velocity threshold
```

Catches stocks on an imminent trajectory toward the zero line before it actually crosses.

#### Condition C — Bullish Price Action near Zero

```ts
(isBullishEngulfing || isHammer) && currentMacd > -0.5
```

Candlestick reversal patterns are only accepted if MACD is very close to zero (within -0.5), preventing false signals in deeply negative trending stocks.

> **If none of A, B, or C are met → `return null` (stock is rejected from the scan).**

### 3.4 Secondary Signal Labels (stacked on top of Gate)

These are additional qualifiers **added** after the gate is passed, providing richer context:

| Signal Label | Condition |
|---|---|
| `RSI_REVERSAL` | RSI was below 35 two bars ago, dipped, then turned up |
| `RSI_50_CROSS` | RSI crossed above 50 on the current candle |
| `EMA_GOLDEN_CROSS` | EMA 9 crossed above EMA 21 |
| `BULLISH_ENGULFING` | Current green candle fully engulfs previous red candle |
| `HAMMER_REVERSAL` | Lower shadow ≥ 2× body, upper shadow ≤ 0.5× body |

### 3.5 Signal Priority Order

When writing to the database, a single `macd_signal` field is set using this priority:

```
ZERO_LINE_CROSS > SIGNAL_LINE_CROSS > APPROACHING_ZERO >
EMA_GOLDEN_CROSS > BULLISH_ENGULFING > HAMMER >
RSI_REVERSAL > RSI_50_CROSS > BULLISH_MOMENTUM
```

---

## 4. Conviction Check (Gate 2 — Daily Candles)

Source: `check3HConviction()` in `aws-ec2-daemon/src/mtf-screener.ts` (L177–L195)

This is **lazy-evaluated**: it only runs if Gate 1 passes. Fetches 40 days of daily candles and evaluates MACD alignment:

```ts
// Daily MACD is bullish if:
curr3h > 0                        // Already above zero line, OR
|| (prev3h < 0 && curr3h > 0)    // Just crossed zero on daily
```

| Result | `conviction` field |
|--------|--------------------|
| Daily MACD above zero | `HIGH` |
| Daily MACD below zero | `NORMAL` |

---

## 5. Discord Sniper Alert

Source: `sendMTFAlert()` in `aws-ec2-daemon/src/lib/notify.ts`

Alerts are **only fired** for the highest-quality setups:

```ts
const isTopTier = conviction === 'HIGH'
  && (signals.includes('ZERO_LINE_CROSS') || signals.includes('SIGNAL_LINE_CROSS'));
```

This means Discord is notified only when **both** the daily trend is bullish **and** a confirmed zero-line cross has occurred on the 30-minute chart — avoiding noise from anticipatory setups.

---

## 6. Database Schema

Source: `aws/mtf_screened_stocks.sql`

### 6.1 `mtf_screened_stocks` — Live Scan Output

| Column | Type | Description |
|--------|------|-------------|
| `instrument_token` | VARCHAR (PK) | Upstox instrument key |
| `tradingsymbol` | VARCHAR | NSE ticker (e.g. `RELIANCE`) |
| `sector` | VARCHAR | Sector tag from instrument master |
| `current_price` | DECIMAL | Last traded price at scan time |
| `mtf_margin_multiplier` | DECIMAL | Upstox MTF leverage bracket (e.g. 3.5×) |
| `distance_from_vwap_pct` | DECIMAL | % distance above/below intraday VWAP |
| `rsi_14` | DECIMAL | RSI value at scan time |
| `macd_value` | DECIMAL | MACD line value |
| `macd_signal` | VARCHAR | Primary signal label (see §3.4) |
| `adx_trend` | DECIMAL | ADX trend strength value |
| `rvol` | DECIMAL | Relative Volume ratio |
| `atr_value` | DECIMAL | ATR (14) value in ₹ |
| `suggested_sl` | DECIMAL | ATR-based stop loss level (2× ATR below entry) |
| `conviction` | VARCHAR | `HIGH` or `NORMAL` |
| `updated_at` | TIMESTAMPTZ | Scan timestamp |

**Index:** `conviction DESC, macd_value DESC, updated_at DESC`
→ HIGH conviction setups with strongest MACD momentum appear first.

### 6.2 `system_controls` — On-Demand Trigger

| Column | Default | Purpose |
|--------|---------|---------
| `id` | 1 | Singleton row |
| `mtf_scan_requested` | `false` | Set to `true` from the UI to trigger a scan |
| `last_scan_time` | — | Updated after every scan completes |

### 6.3 `mtf_instrument_master` — Watchlist

| Column | Default | Description |
|--------|---------|-------------|
| `instrument_token` | PK | Upstox token |
| `tradingsymbol` | — | NSE ticker |
| `sector` | `EQUITY` | Sector classification |
| `liquidity_tier` | `HIGH` | Screener only uses `HIGH` tier stocks |
| `mtf_bracket` | `25.0` | MTF margin bracket from Upstox |
| `is_active` | `true` | Soft-delete flag |

> **Seeding:** Populated by `syncUpstoxInstrumentMaster()` in `lib/instrument-sync.ts`, which parses `Upstox_MTF_enabled.json` (~900 NSE stocks approved for MTF by Upstox).

---

## 7. Scan Lifecycle (Step-by-Step)

```
run15MinScreener()
│
├── 1. Resolve Upstox access token from Supabase system_state
│
├── 2. Load watchlist: mtf_instrument_master WHERE liquidity_tier='HIGH' AND is_active=true
│   └── If empty → auto-call syncUpstoxInstrumentMaster() and retry once
│
├── 3. Launch 6 workers concurrently (Promise.all)
│   │
│   └── Each worker loops over watchlist atomically:
│       ├── A. Fetch 30-min candles (5 days back) via Upstox historical API
│       ├── B. Run detect15mSignals() → PASS or REJECT
│       │       └── REJECT → sleep(60ms), continue to next stock
│       │
│       ├── C. [PASS] Run check3HConviction() on daily candles
│       │       └── Sets conviction = 'HIGH' or 'NORMAL'
│       │
│       ├── D. Build setupData object with all indicators
│       ├── E. Fire sendMTFAlert() if TOP TIER (HIGH + zero-line cross)
│       └── F. Intermediate flush to DB every 10 found stocks (crash safety)
│
├── 4. Final DB flush:
│   ├── DELETE FROM mtf_screened_stocks (wipe stale results)
│   └── UPSERT all matchingStocks
│
└── 5. UPDATE system_controls SET last_scan_time = now()
```

---

## 8. On-Demand Trigger Flow

The UI can trigger a scan at any time without waiting for the cron:

```
User clicks "Scan Now" in Dashboard
  → POST /api/mtf-screener/trigger  (Cloudflare Worker)
  → Supabase UPDATE system_controls SET mtf_scan_requested = true
  → EC2 setInterval(3000) detects mtf_scan_requested = true
  → Immediately resets it to false  (idempotency guard)
  → Calls run15MinScreener()
```

Source: `startMTFTriggerListener()` in `aws-ec2-daemon/src/mtf-screener.ts` (L369–L385)

---

## 9. Morning Briefing Integration

Source: `aws-ec2-daemon/src/morning-briefing.ts`

Every weekday at **08:30 AM IST**, the Morning Briefing cron reads from `mtf_screened_stocks` and sends an AI-generated summary to Discord:

```
08:30 IST (Mon–Fri) cron fires → generateAndSendMorningBriefing()
  │
  ├── Idempotency check: skip if MORNING_BRIEFING already in system_events for today
  ├── SELECT * FROM mtf_screened_stocks WHERE conviction='HIGH' AND updated_at > yesterday
  │
  ├── [No setups] → Send capital-preservation advisory to Discord
  │
  └── [Setups found] → POST to Groq API (llama-3.1-8b-instant)
        Prompt: CRO-style briefing (3 paragraphs: breadth, best setups, risk directives)
        → INSERT into system_events (event_type: 'MORNING_BRIEFING')
        → POST Discord embed (gold color #FFE500, "Quant Desk Morning Briefing")
```

**Empty-day handling:** If no HIGH conviction setups exist, a capital-preservation advisory is sent automatically — the system never sends a blank message.

---

## 10. API Endpoints

Source: `cloud/src/routes/api.ts` (L50–L51)

All MTF screener endpoints require **Basic Auth** (same credentials as the trading dashboard):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mtf-screener` | Returns all rows from `mtf_screened_stocks`, sorted by `conviction DESC, macd_value DESC` |
| `POST` | `/api/mtf-screener/trigger` | Sets `mtf_scan_requested = true` in `system_controls`, triggering the EC2 scan within 3 seconds |

---

## 11. Indicator Library Reference

All indicators are pure stateless functions in `aws-ec2-daemon/src/lib/`:

| File | Exported Function | Description |
|------|-------------------|-------------|
| `lib/macd.ts` | `calculateMACD(closes)` | Returns `{ macdLine, signalLine, histogram }` using 12/26/9 EMA |
| `lib/macd.ts` | `calculateEMA(closes, period)` | Standard exponential moving average |
| `lib/rsi.ts` | `calculateRSI(closes, 14)` | Wilder's smoothed RSI |
| `lib/adx.ts` | `calculateADX(candles, 14)` | Average Directional Index (trend strength) |
| `lib/atr.ts` | `calculateATR(candles, 14)` | Average True Range (volatility measure) |
| `lib/atr.ts` | `calculateSuggestedSL(price, atr, 2.0)` | `price - (multiplier × ATR)` |
| `lib/vwap.ts` | `calculateVWAPDistance(candles)` | % deviation from intraday VWAP |
| `lib/rvol.ts` | `calculateRVOL(candles)` | Current bar volume / rolling average volume |

---

## 12. Environment Variables Required

| Variable | Consumer | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | `mtf-screener.ts` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `mtf-screener.ts` | Service role key — bypasses RLS for bulk writes |
| `DISCORD_MTF_WEBHOOK` | `lib/notify.ts` | Discord webhook URL for sniper alerts |
| `GROQ_API_KEY` | `morning-briefing.ts` | Groq API key for `llama-3.1-8b-instant` morning briefings |

---

## 13. Key Design Decisions

### Why 30-minute candles instead of 15-minute?
The Upstox historical candle API interval key is `'30minute'`. The screener fetches 5 days of these candles (yielding ~80 bars), which provides sufficient warmup length for EMA 26 and MACD signal line calculations.

### Why delete-then-upsert on final flush?
Each scan is a **complete, fresh snapshot** of current market conditions. Old setups from previous scans are stale by definition. The `DELETE` + `UPSERT` pattern guarantees the dashboard always shows only current setups, preventing stale row accumulation across multiple daily scans.

### Why the intermediate flush every 10 stocks?
A crash mid-scan (OOM event, network failure) would otherwise lose all partial results. Flushing to Supabase every 10 discoveries ensures meaningful partial results are preserved — avoiding a full re-scan on recovery.

### Why is the trigger listener polling instead of using Supabase Realtime?
The on-demand trigger uses `setInterval(3s)` polling against `system_controls` rather than Supabase Realtime websocket subscriptions. This is intentional: the MTF scan itself is a long-running job lasting several minutes, and a simple polling check is more robust than managing a persistent Realtime subscription alongside it. Polling also eliminates the risk of a missed Realtime event dropping a user-triggered scan.

---

## 14. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Watchlist is empty — cannot scan` | `mtf_instrument_master` not seeded | Auto-sync fires automatically on empty result; manually verify `Upstox_MTF_enabled.json` is present and `instrument-sync.ts` ran without errors |
| `No active setups detected` after full scan | Market is in downtrend / choppy; all MACD values negative | Expected behavior — the zero-line gate is intentionally strict to avoid low-quality setups |
| Scan runs but zero rows appear in Supabase | Supabase RLS blocking the write | Verify `SUPABASE_SERVICE_ROLE_KEY` is set (not the anon key) — service role bypasses RLS |
| Discord alerts firing for `NORMAL` conviction setups | `isTopTier` guard condition was modified | Only `conviction === 'HIGH' && ZERO_LINE_CROSS` should fire alerts — audit `lib/notify.ts` |
| Morning briefing generates duplicate messages | Idempotency check in `system_events` failed | Confirm `system_events` table has a row with `event_type = 'MORNING_BRIEFING'` and `details->>'briefing_date' = today` after first run |
| Upstox 429 rate-limit errors during scan | Workers running faster than 150 req/s | Increase `sleep(60)` to `sleep(80)` or reduce concurrent workers from 6 to 5 |
| `check3HConviction` always returns `false` | Daily candle API returns < 20 candles | Verify `daysBack=40` in `fetchCandles()` call for the daily timeframe; check for valid `accessToken` |
