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
    conviction VARCHAR NOT NULL DEFAULT 'NORMAL',
    ai_catalyst TEXT,
    catalyst_sentiment VARCHAR(20) DEFAULT 'BULLISH',
    mtf_alignment JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migrations (run if table exists):
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS atr_value DECIMAL DEFAULT 0.0;
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS conviction VARCHAR DEFAULT 'NORMAL';
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS ai_catalyst TEXT;
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS catalyst_sentiment VARCHAR(20) DEFAULT 'BULLISH';
ALTER TABLE mtf_screened_stocks ADD COLUMN IF NOT EXISTS mtf_alignment JSONB;

-- Index: HIGH conviction first, then by MACD momentum
DROP INDEX IF EXISTS idx_mtf_screened_stocks_macd;
CREATE INDEX IF NOT EXISTS idx_mtf_screened_stocks_conviction 
  ON mtf_screened_stocks (conviction DESC, macd_value DESC, updated_at DESC);

-- System Controls
CREATE TABLE IF NOT EXISTS system_controls (
    id INT PRIMARY KEY DEFAULT 1,
    mtf_scan_requested BOOLEAN DEFAULT false,
    last_scan_time TIMESTAMP WITH TIME ZONE
);

INSERT INTO system_controls (id, mtf_scan_requested) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- Instrument Master (seeded from AutoBot Upstox_MTF_enabled.json)
CREATE TABLE IF NOT EXISTS mtf_instrument_master (
    instrument_token VARCHAR PRIMARY KEY,
    tradingsymbol VARCHAR NOT NULL,
    sector VARCHAR DEFAULT 'EQUITY',
    liquidity_tier VARCHAR DEFAULT 'HIGH',
    mtf_bracket DECIMAL DEFAULT 25.0,
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE mtf_instrument_master ADD COLUMN IF NOT EXISTS mtf_bracket DECIMAL DEFAULT 25.0;

CREATE INDEX IF NOT EXISTS idx_mtf_liquidity ON mtf_instrument_master(liquidity_tier);
