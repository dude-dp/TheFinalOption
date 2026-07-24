-- ============================================
-- Schema: Pure Institutional Quant MTF Screener
-- Table: mtf_screened_stocks
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
    suggested_sl DECIMAL DEFAULT 0.0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast query ordering by momentum (macd_value) and recency
CREATE INDEX IF NOT EXISTS idx_mtf_screened_stocks_macd ON mtf_screened_stocks (macd_value DESC, updated_at DESC);
