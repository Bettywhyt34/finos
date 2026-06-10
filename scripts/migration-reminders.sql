-- =============================================================================
-- Migration: Reminder Rules
-- Target: Supabase PostgreSQL 15
-- Run in: Supabase SQL Editor (super-user context)
-- =============================================================================

-- ─── Step 1: Enums ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE reminder_entity_type_enum AS ENUM ('INVOICE', 'BILL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reminder_kind_enum AS ENUM ('MANUAL', 'AUTOMATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reminder_trigger_basis_enum AS ENUM (
    'DUE_DATE',
    'EXPECTED_PAYMENT_DATE',
    'ISSUE_DATE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reminder_direction_enum AS ENUM ('BEFORE', 'AFTER', 'ON_DATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Step 2: reminder_rules table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminder_rules (
  id               TEXT                        NOT NULL PRIMARY KEY,
  tenant_id        UUID                        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type      reminder_entity_type_enum   NOT NULL,
  kind             reminder_kind_enum          NOT NULL DEFAULT 'AUTOMATED',
  name             TEXT                        NOT NULL,
  description      TEXT,
  trigger_basis    reminder_trigger_basis_enum NOT NULL DEFAULT 'DUE_DATE',
  direction        reminder_direction_enum     NOT NULL DEFAULT 'AFTER',
  offset_days      INT                         NOT NULL DEFAULT 0,
  is_system        BOOLEAN                     NOT NULL DEFAULT false,
  is_active        BOOLEAN                     NOT NULL DEFAULT false,
  subject          TEXT,
  body             TEXT,
  created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tenant_reminder_rule_name UNIQUE (tenant_id, entity_type, name)
);

-- ─── Step 3: Indexes ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_reminder_rules_tenant
  ON reminder_rules (tenant_id);

CREATE INDEX IF NOT EXISTS idx_reminder_rules_tenant_entity
  ON reminder_rules (tenant_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_reminder_rules_tenant_active
  ON reminder_rules (tenant_id, is_active);

-- ─── Step 4: updated_at trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at_reminder_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminder_rules_updated_at ON reminder_rules;
CREATE TRIGGER trg_reminder_rules_updated_at
  BEFORE UPDATE ON reminder_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_reminder_rules();

-- ─── Step 5: Row Level Security ───────────────────────────────────────────────

ALTER TABLE reminder_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_rules_tenant_isolation ON reminder_rules;
CREATE POLICY reminder_rules_tenant_isolation ON reminder_rules
  USING (
    tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  );

-- ─── Step 6: Seed system rules per tenant ────────────────────────────────────

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP

    -- INVOICE · MANUAL rules
    INSERT INTO reminder_rules (id, tenant_id, entity_type, kind, name, trigger_basis, direction, offset_days, is_system, is_active)
    VALUES
      (gen_random_uuid()::text, t_id, 'INVOICE', 'MANUAL',    'Reminder for Overdue Invoices', 'DUE_DATE',              'AFTER',   0,  true, false),
      (gen_random_uuid()::text, t_id, 'INVOICE', 'MANUAL',    'Reminder for Sent Invoices',    'ISSUE_DATE',            'AFTER',   0,  true, false),
      (gen_random_uuid()::text, t_id, 'INVOICE', 'AUTOMATED', 'Payment Expected',              'EXPECTED_PAYMENT_DATE', 'ON_DATE', 0,  true, false),
      (gen_random_uuid()::text, t_id, 'INVOICE', 'AUTOMATED', 'Reminder - 1',                  'DUE_DATE',              'ON_DATE', 0,  true, false),
      (gen_random_uuid()::text, t_id, 'INVOICE', 'AUTOMATED', 'Reminder - 2',                  'DUE_DATE',              'AFTER',   7,  true, false),
      (gen_random_uuid()::text, t_id, 'INVOICE', 'AUTOMATED', 'Reminder - 3',                  'DUE_DATE',              'AFTER',   14, true, false),
      (gen_random_uuid()::text, t_id, 'BILL',    'MANUAL',    'Reminder for Upcoming Bills',   'DUE_DATE',              'BEFORE',  0,  true, false),
      (gen_random_uuid()::text, t_id, 'BILL',    'MANUAL',    'Reminder for Overdue Bills',    'DUE_DATE',              'AFTER',   0,  true, false),
      (gen_random_uuid()::text, t_id, 'BILL',    'AUTOMATED', 'Bill Due Reminder',             'DUE_DATE',              'BEFORE',  3,  true, false),
      (gen_random_uuid()::text, t_id, 'BILL',    'AUTOMATED', 'Overdue Bill Reminder',         'DUE_DATE',              'AFTER',   1,  true, false)
    ON CONFLICT ON CONSTRAINT uq_tenant_reminder_rule_name DO NOTHING;

  END LOOP;
END $$;

-- ─── Gates ────────────────────────────────────────────────────────────────────

-- W5a: table exists
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'reminder_rules'
  ) = 1, 'Gate W5a FAILED: reminder_rules table not found';
END $$;

-- W5b: unique constraint exists
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_tenant_reminder_rule_name'
      AND table_name      = 'reminder_rules'
  ) = 1, 'Gate W5b FAILED: unique constraint uq_tenant_reminder_rule_name not found';
END $$;

-- W5c: indexes exist
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'reminder_rules'
      AND indexname  = 'idx_reminder_rules_tenant'
  ) = 1, 'Gate W5c FAILED: idx_reminder_rules_tenant not found';
END $$;

-- W5d: all 4 enums exist
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM pg_type
    WHERE typname IN (
      'reminder_entity_type_enum',
      'reminder_kind_enum',
      'reminder_trigger_basis_enum',
      'reminder_direction_enum'
    )
  ) = 4, 'Gate W5d FAILED: one or more reminder enums not found';
END $$;

-- W5e: seed produced rows for each tenant
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(DISTINCT tenant_id) FROM reminder_rules WHERE is_system = true
  ) = (SELECT COUNT(*) FROM tenants),
  'Gate W5e FAILED: not all tenants have seeded reminder rules';
END $$;

SELECT 'Migration reminder_rules complete — all gates passed' AS result;
