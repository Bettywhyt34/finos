-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Membership Status + Tenant Invitations
-- Run in Supabase SQL Editor (DIRECT_URL / session pooler, port 5432)
-- ─────────────────────────────────────────────────────────────────────────────
-- Changes:
--   1. membership_status_enum     — ACTIVE | INACTIVE
--   2. tenant_memberships.status  — new column (default ACTIVE)
--   3. tenant_memberships.updated_at — new column (audit trail)
--   4. invitation_status_enum     — PENDING | ACCEPTED | EXPIRED | REVOKED
--   5. tenant_invitations table   — full invitation lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. membership_status enum ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE membership_status_enum AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'membership_status_enum already exists, skipping.';
END $$;

-- ── 2. Add status + updated_at to tenant_memberships ─────────────────────────

ALTER TABLE tenant_memberships
  ADD COLUMN IF NOT EXISTS status     membership_status_enum NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Back-fill updated_at from created_at for all existing rows
UPDATE tenant_memberships
   SET updated_at = created_at
 WHERE updated_at IS NULL;

-- Make updated_at NOT NULL with a default going forward
ALTER TABLE tenant_memberships
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- ── 3. invitation_status enum ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE invitation_status_enum AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'invitation_status_enum already exists, skipping.';
END $$;

-- ── 4. tenant_invitations table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_invitations (
  id            UUID                   NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID                   NOT NULL,
  email         TEXT                   NOT NULL,
  role          "UserRole"             NOT NULL DEFAULT 'MEMBER',
  token         UUID                   NOT NULL DEFAULT gen_random_uuid(),
  status        invitation_status_enum NOT NULL DEFAULT 'PENDING',
  invited_by_id TEXT                   NOT NULL,
  expires_at    TIMESTAMPTZ            NOT NULL,
  created_at    TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

  CONSTRAINT tenant_invitations_pkey
    PRIMARY KEY (id),
  CONSTRAINT tenant_invitations_token_key
    UNIQUE (token),
  CONSTRAINT tenant_invitations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT tenant_invitations_invited_by_id_fkey
    FOREIGN KEY (invited_by_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON tenant_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email  ON tenant_invitations(email);
-- Note: token has a UNIQUE constraint (tenant_invitations_token_key) which already
-- creates a B-tree index. A separate idx_invitations_token would be redundant.
CREATE INDEX IF NOT EXISTS idx_invitations_status ON tenant_invitations(status);

-- ── Gate checks ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- W1a: status column on tenant_memberships
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tenant_memberships' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'Gate W1a FAIL: status column missing from tenant_memberships';
  END IF;

  -- W1b: updated_at column on tenant_memberships
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tenant_memberships' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'Gate W1b FAIL: updated_at column missing from tenant_memberships';
  END IF;

  -- W1c: tenant_invitations table created
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'tenant_invitations'
  ) THEN
    RAISE EXCEPTION 'Gate W1c FAIL: tenant_invitations table missing';
  END IF;

  -- W1d: existing memberships all have status = ACTIVE (no nulls or bad values)
  IF EXISTS (
    SELECT 1 FROM tenant_memberships WHERE status IS NULL
  ) THEN
    RAISE EXCEPTION 'Gate W1d FAIL: null status found in tenant_memberships';
  END IF;

  RAISE NOTICE 'Migration: all gates passed ✓';
END $$;

COMMIT;
