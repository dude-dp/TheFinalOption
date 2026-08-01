-- ============================================
-- MTF Screener: system_logs table migration
-- Run against your Supabase project:
--   Dashboard → SQL Editor → Paste → Run
--   OR: supabase db push
-- ============================================

-- Worker telemetry log table
-- Replaces the local daemon.log file entirely.
-- All Cloudflare Worker log writes go here via logger.ts.

CREATE TABLE IF NOT EXISTS system_logs (
  id          BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level       TEXT NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  source      TEXT NOT NULL DEFAULT 'cf-worker',
  message     TEXT NOT NULL
);

-- Index for dashboard UI sorted queries (newest first)
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp
  ON system_logs (timestamp DESC);

-- Optional: auto-purge logs older than 7 days to control table size
-- (uncomment if you want automated TTL cleanup via a Supabase cron job)
-- CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs (level);

-- Verify
COMMENT ON TABLE system_logs IS
  'Fire-and-forget log sink for Cloudflare Workers. Replaces local daemon.log.';
