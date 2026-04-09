-- ============================================================
-- OAuth Integration Migration
-- Adds OAuth 2.0 token fields to integration_connections
-- and creates oauth_states table for CSRF protection.
--
-- Run in Supabase SQL Editor BEFORE running prisma generate.
-- ============================================================

-- ─── Extend integration_connections ──────────────────────────────────────────

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS access_token_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scope                   TEXT,
  ADD COLUMN IF NOT EXISTS source_org_id           TEXT,
  ADD COLUMN IF NOT EXISTS source_org_name         TEXT,
  ADD COLUMN IF NOT EXISTS connected_by_user_id    TEXT;

-- Widen the status check constraint to include TOKEN_EXPIRED
ALTER TABLE integration_connections
  DROP CONSTRAINT IF EXISTS integration_connections_status_check,
  DROP CONSTRAINT IF EXISTS uq_integration_connection; -- will re-add

ALTER TABLE integration_connections
  ADD CONSTRAINT integration_connections_status_check
    CHECK (status IN ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'TOKEN_EXPIRED')),
  ADD CONSTRAINT uq_integration_connection
    UNIQUE (organization_id, source_app);

-- ─── OAuth state table (CSRF protection) ─────────────────────────────────────
-- Each row lives for 10 minutes maximum; consumed on first use.

CREATE TABLE IF NOT EXISTS oauth_states (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  state           TEXT        NOT NULL UNIQUE,
  organization_id TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  source_app      TEXT        NOT NULL CHECK (source_app IN ('revflow', 'xpenxflow', 'earnmark360')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state      ON oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states (expires_at);

-- ─── Verify ──────────────────────────────────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'integration_connections'
  AND column_name  IN (
    'access_token_encrypted', 'refresh_token_encrypted',
    'token_expires_at', 'scope', 'source_org_id', 'source_org_name'
  )
ORDER BY column_name;
