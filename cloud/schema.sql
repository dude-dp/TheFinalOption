-- ============================================
-- TheFinalOption D1 Database Schema
-- Cloudflare D1 (SQLite) — Production Schema
-- ============================================

-- Per-minute execution telemetry from the Cron Worker
CREATE TABLE IF NOT EXISTS system_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    nifty_spot REAL NOT NULL,
    atm_strike INTEGER NOT NULL,
    macd_line REAL NOT NULL,
    prev_macd_line REAL NOT NULL,
    signal_generated TEXT CHECK(signal_generated IN ('NONE', 'BUY_CE', 'BUY_PE')) DEFAULT 'NONE',
    bot_status TEXT NOT NULL,
    log_message TEXT
);

-- Complete trade lifecycle ledger
CREATE TABLE IF NOT EXISTS order_ledger (
    order_id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    instrument_token TEXT NOT NULL,
    trading_symbol TEXT NOT NULL,
    option_type TEXT CHECK(option_type IN ('CE', 'PE')),
    strike_price INTEGER NOT NULL,
    transaction_type TEXT CHECK(transaction_type IN ('BUY', 'SELL')),
    quantity INTEGER NOT NULL,
    lots INTEGER NOT NULL,
    order_price REAL,
    execution_price REAL,
    order_status TEXT CHECK(order_status IN (
        'PENDING', 'DISPATCHED', 'FILLED', 
        'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED'
    )) DEFAULT 'PENDING',
    rejection_reason TEXT,
    pnl REAL DEFAULT 0,
    upstox_order_id TEXT
);

-- End-of-day AI-generated performance summaries
CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL UNIQUE,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    ai_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Dynamic bot configuration (editable from dashboard)
CREATE TABLE IF NOT EXISTS bot_configuration (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Default configuration values
INSERT OR IGNORE INTO bot_configuration (config_key, config_value) VALUES 
    ('max_risk_pct', '20'),
    ('nifty_lot_size', '65'),
    ('rollover_on_expiry', 'true'),
    ('default_expiry', 'weekly'),
    ('max_strike_levels', '2'),
    ('strike_interval', '50'),
    ('square_off_time', '15:15'),
    ('paper_mode', 'false');

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON system_telemetry(timestamp);
CREATE INDEX IF NOT EXISTS idx_order_status ON order_ledger(order_status);
CREATE INDEX IF NOT EXISTS idx_order_correlation ON order_ledger(correlation_id);
CREATE INDEX IF NOT EXISTS idx_order_created ON order_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_summary_date ON daily_summary(trade_date);
