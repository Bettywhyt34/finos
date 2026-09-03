-- Distinguish full cash payment from bills closed by vendor credits or mixed settlement.
ALTER TYPE public."BillStatus" ADD VALUE IF NOT EXISTS 'SETTLED' AFTER 'PAID';
