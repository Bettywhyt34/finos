-- Cover the bill_line_id foreign key independently of tenant-leading query indexes.
CREATE INDEX IF NOT EXISTS bill_line_cost_recognitions_bill_line_fk_idx
  ON public.bill_line_cost_recognitions (bill_line_id);
