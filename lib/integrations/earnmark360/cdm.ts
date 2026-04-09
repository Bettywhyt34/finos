/**
 * EARNMARK360 Common Data Model (CDM)
 *
 * Field names match EARNMARK360's REST API verbatim.
 * All monetary amounts are plain numbers (NGN).
 * All dates are ISO 8601 strings; processor converts to Date objects.
 */

// ─── Employee ─────────────────────────────────────────────────────────────────

export type EMKEmployeeStatus = "active" | "inactive";

export interface EMKEmployee {
  id:            string;
  employee_code: string;       // e.g. "EMP001"
  name:          string;
  department:    string;
  job_title:     string;
  hire_date:     string;       // ISO date
  status:        EMKEmployeeStatus;
  email:         string;
  phone:         string | null;
}

// ─── Payroll Run ──────────────────────────────────────────────────────────────

export type EMKPayrollRunStatus = "processed" | "pending";

export interface EMKPayrollRun {
  id:           string;
  run_date:     string;        // ISO date — date the payroll was processed
  period_start: string;        // ISO date — pay period start
  period_end:   string;        // ISO date — pay period end
  total_gross:  number;        // total gross pay across all employees
  total_net:    number;        // total net pay across all employees
  status:       EMKPayrollRunStatus;
}

// ─── Payroll Line (one row per employee per payroll run) ──────────────────────

export interface EMKPayrollLine {
  id:             string;
  employee_id:    string;       // FK to EMKEmployee.id
  payroll_run_id: string;       // FK to EMKPayrollRun.id
  gross_pay:      number;
  paye:           number;       // Pay As You Earn tax
  pension_ee:     number;       // Employee pension contribution
  pension_er:     number;       // Employer pension contribution
  nhf:            number;       // National Housing Fund
  nsitf:          number;       // Nigeria Social Insurance Trust Fund
  net_pay:        number;       // gross_pay - paye - pension_ee - nhf - nsitf
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export type EMKLeaveType = "annual" | "sick" | "maternity" | "paternity" | "unpaid";

export interface EMKAttendance {
  id:           string;
  employee_id:  string;         // FK to EMKEmployee.id
  date:         string;         // ISO date
  hours_worked: number;
  leave_type:   EMKLeaveType | null;
}

// ─── Deduction ────────────────────────────────────────────────────────────────

export type EMKDeductionType =
  | "PAYE"
  | "PENSION_EE"
  | "PENSION_ER"
  | "NHF"
  | "NSITF";

export interface EMKDeduction {
  id:          string;
  employee_id: string;          // FK to EMKEmployee.id
  type:        EMKDeductionType;
  amount:      number;
  period:      string;          // YYYY-MM
}

// ─── Sync cursor ──────────────────────────────────────────────────────────────

export interface EMKSyncCursor {
  since: string; // ISO datetime
}

export function parseCursor(raw: string | undefined | null): EMKSyncCursor {
  if (!raw) return { since: "1970-01-01T00:00:00.000Z" };
  try {
    return JSON.parse(raw) as EMKSyncCursor;
  } catch {
    return { since: raw }; // backwards compat: plain ISO string
  }
}

export function stringifyCursor(cursor: EMKSyncCursor): string {
  return JSON.stringify(cursor);
}
