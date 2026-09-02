ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_payment_terms_days_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_payment_terms_days_check
  CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 3650);
