-- Live hardening migration mirrored for migration-history parity.
-- The source foundation migration already includes these guards for fresh databases.

DROP TRIGGER IF EXISTS enforce_accrual_identity ON public.accruals;
CREATE TRIGGER enforce_accrual_identity
BEFORE INSERT OR UPDATE OF tenant_id,vendor_id,account_id,project_id,currency,amount,accrual_date
ON public.accruals
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_identity();

DROP TRIGGER IF EXISTS enforce_accrual_settlement_identity ON public.accrual_settlements;
CREATE TRIGGER enforce_accrual_settlement_identity
BEFORE INSERT OR UPDATE OF tenant_id,accrual_id,bill_line_id,settlement_date,amount,status
ON public.accrual_settlements
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_settlement_identity();

DROP TRIGGER IF EXISTS enforce_accrual_release_identity ON public.accrual_releases;
CREATE TRIGGER enforce_accrual_release_identity
BEFORE INSERT OR UPDATE OF tenant_id,accrual_id,release_date,amount,status
ON public.accrual_releases
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_release_identity();

DROP TRIGGER IF EXISTS enforce_accrual_source_reversal_order ON public.accruals;
CREATE TRIGGER enforce_accrual_source_reversal_order
BEFORE UPDATE OF status ON public.accruals
FOR EACH ROW EXECUTE FUNCTION public.guard_accrual_source_reversal();