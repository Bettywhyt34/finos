-- ============================================================
-- BettyWhyt ↔ FINOS Integration Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add inventory quantity columns to items
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS qty_online   DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_pos      DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_reserved DECIMAL(18,2) DEFAULT 0;

-- 2. Create inventory_movements audit table
-- NOTE: Prisma stores all @id fields as TEXT (not UUID) in this project.
-- organization_id and item_id must be TEXT to match the referenced PKs.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id         TEXT        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  movement_type   TEXT        NOT NULL, -- SALE_ONLINE | SALE_POS | RECEIPT | ADJUSTMENT | RESERVATION | RELEASE
  channel         TEXT        NOT NULL, -- ONLINE | POS | BOTH
  quantity        DECIMAL(18,2) NOT NULL,
  unit_cost       DECIMAL(18,2),
  reference       TEXT,
  source_app      TEXT,       -- bettywhyt | finos
  source_id       TEXT,       -- order number / bill id
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_org_item
  ON inventory_movements (organization_id, item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_source
  ON inventory_movements (source_app, source_id);
