-- FX Revaluation migration
-- Run this in Supabase SQL Editor (Settings → SQL Editor)

-- Create enum type
DO $$ BEGIN
  CREATE TYPE fx_revaluation_status AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create fx_revaluations table
-- NOTE: Prisma maps String @id to TEXT (not native UUID), so all FK columns use TEXT
CREATE TABLE IF NOT EXISTS fx_revaluations (
  id                   TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT          NOT NULL REFERENCES organizations(id),
  revaluation_date     TIMESTAMPTZ   NOT NULL,
  period               VARCHAR(7)    NOT NULL,        -- YYYY-MM
  currency             VARCHAR(10)   NOT NULL,
  opening_rate         NUMERIC(15,6) NOT NULL DEFAULT 1,
  closing_rate         NUMERIC(15,6) NOT NULL,
  ar_exposure          NUMERIC(15,2) NOT NULL DEFAULT 0,  -- total foreign AR balance
  ap_exposure          NUMERIC(15,2) NOT NULL DEFAULT 0,  -- total foreign AP balance
  ar_booked_ngn        NUMERIC(15,2) NOT NULL DEFAULT 0,  -- AR at original rates (NGN)
  ap_booked_ngn        NUMERIC(15,2) NOT NULL DEFAULT 0,  -- AP at original rates (NGN)
  ar_current_ngn       NUMERIC(15,2) NOT NULL DEFAULT 0,  -- AR at closing rate (NGN)
  ap_current_ngn       NUMERIC(15,2) NOT NULL DEFAULT 0,  -- AP at closing rate (NGN)
  ar_gain_loss         NUMERIC(15,2) NOT NULL DEFAULT 0,  -- positive = gain
  ap_gain_loss         NUMERIC(15,2) NOT NULL DEFAULT 0,  -- positive = gain
  unrealized_gain_loss NUMERIC(15,2) NOT NULL DEFAULT 0,  -- net gain/loss
  fx_gain_account_code VARCHAR(20)   NOT NULL,
  fx_loss_account_code VARCHAR(20)   NOT NULL,
  journal_entry_id     TEXT          UNIQUE REFERENCES journal_entries(id),
  status               fx_revaluation_status NOT NULL DEFAULT 'DRAFT',
  notes                TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  posted_at            TIMESTAMPTZ,
  posted_by            TEXT,

  CONSTRAINT uq_fx_reval_org_period_currency UNIQUE (organization_id, period, currency)
);

-- Index for list queries by org + status
CREATE INDEX IF NOT EXISTS idx_fx_revaluations_org ON fx_revaluations (organization_id, period DESC);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'fx_revaluations'
ORDER BY ordinal_position;
