"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateProject, type ProjectEditState } from "../edit-actions";

interface Option { id: string; label: string }
interface Milestone { percentage: number; expectedDate: string }

export interface EditableProject {
  id: string;
  name: string;
  code: string | null;
  customerId: string;
  description: string | null;
  currency: string;
  startDate: string;
  endDate: string | null;
  contractValue: number;
  costBudget: number | null;
  marginTarget: number | null;
  defaultIncomeAccountId: string | null;
  contractAssetAccountId: string | null;
  unearnedIncomeAccountId: string | null;
  billingSchedule: Milestone[];
  notes: string | null;
  hasFinancialActivity: boolean;
}

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15";
const labelClass = "text-sm font-medium text-[var(--text-primary)]";
const initialState: ProjectEditState = {};

export function ProjectEditForm({
  project,
  customers,
  incomeAccounts,
  assetAccounts,
  liabilityAccounts,
}: {
  project: EditableProject;
  customers: Option[];
  incomeAccounts: Option[];
  assetAccounts: Option[];
  liabilityAccounts: Option[];
}) {
  const action = updateProject.bind(null, project.id);
  const [state, formAction, pending] = useActionState(action, initialState);
  const milestones = [0, 1, 2].map((index) => project.billingSchedule[index] ?? { percentage: 0, expectedDate: "" });

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <div role="alert" className="rounded-lg border border-[#E4BBBB] bg-[#F8EAEA] px-4 py-3 text-sm text-[var(--critical)]">{state.error}</div> : null}
      {project.hasFinancialActivity ? (
        <div className="rounded-xl border border-[#E7D09F] bg-[#FBF1DF] px-4 py-3 text-sm text-[var(--attention)]">
          This Project already has posted financial activity. Customer and currency are locked; other changes are prospective and do not rewrite posted accounting history.
        </div>
      ) : null}

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Project basics</h2>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <label className={labelClass}>Project name *<input className={inputClass} name="name" required maxLength={160} defaultValue={project.name} /></label>
          <label className={labelClass}>Customer *
            <select className={inputClass} name="customerId" required defaultValue={project.customerId} disabled={project.hasFinancialActivity}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
            </select>
            {project.hasFinancialActivity ? <input type="hidden" name="customerId" value={project.customerId} /> : null}
          </label>
          <label className={labelClass}>Project code<input className={inputClass} name="code" maxLength={50} defaultValue={project.code ?? ""} /></label>
          <label className={labelClass}>Currency
            <input className={inputClass} name="currency" maxLength={3} required defaultValue={project.currency} readOnly={project.hasFinancialActivity} />
          </label>
          <label className={labelClass}>Start date *<input className={inputClass} type="date" name="startDate" required defaultValue={project.startDate} /></label>
          <label className={labelClass}>End date<input className={inputClass} type="date" name="endDate" defaultValue={project.endDate ?? ""} /></label>
          <label className={`${labelClass} md:col-span-2`}>Description<textarea className="mt-1.5 min-h-24 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15" name="description" maxLength={2000} defaultValue={project.description ?? ""} /></label>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Commercial plan</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Revisions here change planning information only. They do not post or reverse accounting entries.</p>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
          <label className={labelClass}>Contract value *<input className={`${inputClass} tabular-nums`} name="contractValue" type="number" min="0" step="0.01" required defaultValue={project.contractValue} /></label>
          <label className={labelClass}>Cost budget<input className={`${inputClass} tabular-nums`} name="costBudget" type="number" min="0" step="0.01" defaultValue={project.costBudget ?? ""} /></label>
          <label className={labelClass}>Margin target (%)<input className={`${inputClass} tabular-nums`} name="marginTarget" type="number" min="0" max="100" step="0.01" defaultValue={project.marginTarget ?? ""} /></label>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Billing plan</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Optional planning only. Updating this schedule does not create invoices or recognise revenue.</p>
        <div className="mt-6 overflow-hidden rounded-lg border border-[var(--app-border)]">
          <div className="grid grid-cols-[80px_1fr_1fr] gap-4 bg-[var(--surface-muted)] px-4 py-3 text-xs font-medium text-[var(--text-secondary)]"><span>Stage</span><span>Percentage</span><span>Expected billing date</span></div>
          {milestones.map((milestone, index) => (
            <div key={index} className="grid grid-cols-[80px_1fr_1fr] items-center gap-4 border-t border-[var(--app-border)] px-4 py-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">{index + 1}</span>
              <input aria-label={`Billing percentage ${index + 1}`} className="h-9 rounded-lg border border-[var(--app-border)] px-3 text-sm tabular-nums" name={`billingPercentage${index + 1}`} type="number" min="0" max="100" step="0.01" defaultValue={milestone.percentage || ""} />
              <input aria-label={`Billing date ${index + 1}`} className="h-9 rounded-lg border border-[var(--app-border)] px-3 text-sm" name={`billingDate${index + 1}`} type="date" defaultValue={milestone.expectedDate} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Future accounting defaults</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Changes apply prospectively. Posted invoices and recognition events retain their original account evidence.</p>
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <AccountSelect name="defaultIncomeAccountId" label="Default income account" options={incomeAccounts} value={project.defaultIncomeAccountId} />
          <AccountSelect name="contractAssetAccountId" label="Contract Asset account" options={assetAccounts} value={project.contractAssetAccountId} />
          <AccountSelect name="unearnedIncomeAccountId" label="Unearned Income account" options={liabilityAccounts} value={project.unearnedIncomeAccountId} />
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Notes</h2>
        <textarea className="mt-5 min-h-28 w-full rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15" name="notes" maxLength={4000} defaultValue={project.notes ?? ""} />
      </section>

      <div className="flex items-center justify-end gap-3 pb-8">
        <Link href={`/projects/${project.id}`} className="flex h-10 items-center rounded-lg border border-[var(--app-border)] bg-white px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]">Cancel</Link>
        <button disabled={pending} className="h-10 rounded-lg bg-[var(--finos-accent)] px-5 text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

function AccountSelect({ name, label, options, value }: { name: string; label: string; options: Option[]; value: string | null }) {
  return (
    <label className={labelClass}>{label}
      <select className={inputClass} name={name} defaultValue={value ?? ""}>
        <option value="">Use inherited default</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
