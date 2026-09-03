ALTER TABLE public.vendor_credits
  DROP CONSTRAINT IF EXISTS vendor_credits_status_check,
  DROP CONSTRAINT IF EXISTS vendor_credits_status_balance_check;

ALTER TABLE public.vendor_credits
  ADD CONSTRAINT vendor_credits_status_check CHECK (status IN ('OPEN','APPLIED','CLOSED','REVERSED')),
  ADD CONSTRAINT vendor_credits_status_balance_check CHECK (
    (status = 'OPEN' AND remaining_amount > 0.01)
    OR (status IN ('APPLIED','CLOSED') AND remaining_amount <= 0.01)
    OR (status = 'REVERSED')
  );