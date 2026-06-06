-- ─── Branding Preferences Migration ─────────────────────────────────────────
-- Run in Supabase SQL Editor

-- Org-level branding toggles stored on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS keep_branding  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS recommend_app  BOOLEAN NOT NULL DEFAULT TRUE;

-- Gates
DO $$
BEGIN
  ASSERT (SELECT column_name FROM information_schema.columns WHERE table_name='tenants' AND column_name='keep_branding')  IS NOT NULL, 'W-BRAND-1 FAIL';
  ASSERT (SELECT column_name FROM information_schema.columns WHERE table_name='tenants' AND column_name='recommend_app') IS NOT NULL, 'W-BRAND-2 FAIL';
  RAISE NOTICE 'Branding prefs migration: all gates passed ✓';
END $$;
