/**
 * Migration: Transaction Number Series
 *
 * Creates the transaction_number_series table, 2 enums, RLS policy,
 * and seeds 10 default series rows per existing tenant.
 *
 * IDEMPOTENT — safe to run multiple times.
 * New enums use EXCEPTION WHEN duplicate_object handling.
 * Seed uses ON CONFLICT ON CONSTRAINT uq_tns_tenant_module DO NOTHING.
 *
 * Gate checks at the end assert all structures exist.
 */

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE transaction_module_enum AS ENUM (
    'INVOICE',
    'CUSTOMER_PAYMENT',
    'CREDIT_NOTE',
    'BILL',
    'VENDOR_PAYMENT',
    'JOURNAL',
    'ESTIMATE',
    'PURCHASE_ORDER',
    'VENDOR_CREDIT',
    'DEBIT_NOTE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE number_restart_frequency_enum AS ENUM (
    'NEVER',
    'MONTHLY',
    'YEARLY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transaction_number_series (
  id              TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module          transaction_module_enum NOT NULL,
  prefix          TEXT         NOT NULL DEFAULT '',
  next_number     INT          NOT NULL DEFAULT 1,
  pad_length      INT          NOT NULL DEFAULT 5,
  restart_freq    number_restart_frequency_enum NOT NULL DEFAULT 'NEVER',
  last_reset_date TIMESTAMPTZ,
  is_enabled      BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tns_tenant_module UNIQUE (tenant_id, module),
  CONSTRAINT chk_tns_pad_length   CHECK (pad_length BETWEEN 1 AND 10),
  CONSTRAINT chk_tns_next_number  CHECK (next_number >= 1)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tns_tenant_id
  ON transaction_number_series (tenant_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tns_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tns_updated_at ON transaction_number_series;
CREATE TRIGGER trg_tns_updated_at
  BEFORE UPDATE ON transaction_number_series
  FOR EACH ROW EXECUTE FUNCTION fn_tns_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE transaction_number_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tns_tenant_isolation ON transaction_number_series;
CREATE POLICY tns_tenant_isolation ON transaction_number_series
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- ── Seed defaults per existing tenant ────────────────────────────────────────

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants
  LOOP
    INSERT INTO transaction_number_series
      (id, tenant_id, module, prefix, next_number, pad_length, restart_freq, is_enabled)
    VALUES
      (gen_random_uuid()::text, t_id, 'INVOICE'::transaction_module_enum,          'INV',  1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'CUSTOMER_PAYMENT'::transaction_module_enum, 'PAY',  1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'CREDIT_NOTE'::transaction_module_enum,      'CN',   1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'BILL'::transaction_module_enum,             'BILL', 1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'VENDOR_PAYMENT'::transaction_module_enum,   'VPAY', 1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'JOURNAL'::transaction_module_enum,          'JNL',  1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'ESTIMATE'::transaction_module_enum,         'EST',  1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'PURCHASE_ORDER'::transaction_module_enum,   'PO',   1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'VENDOR_CREDIT'::transaction_module_enum,    'VC',   1, 5, 'NEVER'::number_restart_frequency_enum, true),
      (gen_random_uuid()::text, t_id, 'DEBIT_NOTE'::transaction_module_enum,       'DN',   1, 5, 'NEVER'::number_restart_frequency_enum, true)
    ON CONFLICT ON CONSTRAINT uq_tns_tenant_module DO NOTHING;
  END LOOP;
END $$;

-- ── Gate checks ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'transaction_number_series'
    )
  ), 'GATE FAIL: transaction_number_series table not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'transaction_module_enum'
    )
  ), 'GATE FAIL: transaction_module_enum not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'number_restart_frequency_enum'
    )
  ), 'GATE FAIL: number_restart_frequency_enum not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name       = 'transaction_number_series'
        AND constraint_name  = 'uq_tns_tenant_module'
        AND constraint_type  = 'UNIQUE'
    )
  ), 'GATE FAIL: uq_tns_tenant_module unique constraint not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename  = 'transaction_number_series'
        AND indexname  = 'idx_tns_tenant_id'
    )
  ), 'GATE FAIL: idx_tns_tenant_id index not found';
END $$;

SELECT 'Transaction number series migration complete — all gates passed.' AS status;
