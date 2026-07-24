-- ============================================
-- Schema: Pure Institutional Quant MTF Screener
-- Table: mtf_screened_stocks, system_controls & mtf_instrument_master
-- ============================================

CREATE TABLE IF NOT EXISTS mtf_screened_stocks (
    instrument_token VARCHAR PRIMARY KEY,
    tradingsymbol VARCHAR NOT NULL,
    sector VARCHAR NOT NULL DEFAULT 'GENERAL',
    current_price DECIMAL NOT NULL,
    mtf_margin_multiplier DECIMAL DEFAULT 2.0, 
    distance_from_vwap_pct DECIMAL DEFAULT 0.0,
    rsi_14 DECIMAL DEFAULT 50.0,
    macd_value DECIMAL DEFAULT 0.0,
    macd_signal VARCHAR NOT NULL DEFAULT 'NEUTRAL', 
    adx_trend DECIMAL DEFAULT 0.0,
    rvol DECIMAL DEFAULT 1.0,
    atr_value DECIMAL DEFAULT 0.0,
    suggested_sl DECIMAL DEFAULT 0.0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration query if table already exists:
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS atr_value DECIMAL DEFAULT 0.0;

-- Index for fast query ordering by momentum (macd_value) and recency
CREATE INDEX IF NOT EXISTS idx_mtf_screened_stocks_macd ON mtf_screened_stocks (macd_value DESC, updated_at DESC);

-- System Controls Table for On-Demand Triggers & Telemetry Bridge
CREATE TABLE IF NOT EXISTS system_controls (
    id INT PRIMARY KEY DEFAULT 1,
    mtf_scan_requested BOOLEAN DEFAULT false,
    last_scan_time TIMESTAMP WITH TIME ZONE
);

-- Seed default control record
INSERT INTO system_controls (id, mtf_scan_requested) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- Instrument Master Table storing live Upstox NSE equities and liquidity tiers
CREATE TABLE IF NOT EXISTS mtf_instrument_master (
    instrument_token VARCHAR PRIMARY KEY,
    tradingsymbol VARCHAR NOT NULL,
    sector VARCHAR DEFAULT 'EQUITY',
    liquidity_tier VARCHAR DEFAULT 'LOW', -- 'HIGH' for F&O constituents, 'LOW' for others
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mtf_liquidity ON mtf_instrument_master(liquidity_tier);
