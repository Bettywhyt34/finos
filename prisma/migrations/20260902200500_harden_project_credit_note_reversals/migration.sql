-- Final dependency guards for project-linked credit notes.

CREATE OR REPLACE FUNCTION public.guard_project_recognition_reversal_after_credit_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM public.credit_note_project_adjustments cnpa
      JOIN public.credit_notes cn ON cn.id = cnpa.credit_note_id
      WHERE cnpa.source_recognition_id = OLD.id
        AND cn.tenant_id = OLD.tenant_id
        AND cn.status = 'APPLIED'
    ) THEN
      RAISE EXCEPTION 'This Project revenue recognition is referenced by an applied credit note. Reverse the dependent credit note first.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_project_recognition_reversal_after_credit_note
  ON public.project_revenue_recognitions;
CREATE TRIGGER guard_project_recognition_reversal_after_credit_note
BEFORE UPDATE OF status ON public.project_revenue_recognitions
FOR EACH ROW EXECUTE FUNCTION public.guard_project_recognition_reversal_after_credit_note();

CREATE OR REPLACE FUNCTION public.guard_credit_note_reversal_after_later_fx_revaluation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'APPLIED' AND NEW.status = 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM public.fx_revaluation_items fri
      JOIN public.fx_revaluations fr ON fr.id = fri.fx_revaluation_id
      WHERE fri.tenant_id = OLD.tenant_id
        AND fri.item_type = 'AR'
        AND fri.invoice_id = OLD.invoice_id
        AND fr.status = 'POSTED'
        AND fr.revaluation_date > OLD.issue_date
    ) THEN
      RAISE EXCEPTION 'A later FX revaluation depends on this credit note. Reverse the later revaluation first.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_credit_note_reversal_after_later_fx_revaluation
  ON public.credit_notes;
CREATE TRIGGER guard_credit_note_reversal_after_later_fx_revaluation
BEFORE UPDATE OF status ON public.credit_notes
FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_reversal_after_later_fx_revaluation();
