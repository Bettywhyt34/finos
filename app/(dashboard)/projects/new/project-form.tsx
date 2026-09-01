"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createProject, type ProjectActionState } from "../actions";

interface Option { id: string; label: string; }
interface ProjectFormProps {
  customers: Option[];
  incomeAccounts: Option[];
  assetAccounts: Option[];
  liabilityAccounts: Option[];
  currency: string;
}

const initialState: ProjectActionState = {};

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15";
const labelClass = "text-sm font-medium text-[var(--text-primary)]";

export function ProjectForm({ customers, incomeAccounts, assetAccounts, liabilityAccounts, currency }: ProjectFormProps) {
  const [state, formAction, pending] = useActionState(createProject, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? (
        <div role="alert" className="rounded-lg border border-[#E4BBBB] bg-[#F8EAEA] px-4 py-3 text-sm text-[var(--critical)]">
          {state.error}
        </div>
      ) : null}

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Project basics</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Identify the customer, commercial period and project status.</p>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <label className={labelClass}>Project name *
            <input className={inputClass} name="name" required maxLength={160} placeholder="Arewa Q3 Campaign" />
          </label>
          <label className={labelClass}>Customer *
            <select className={inputClass} name="customerId" required defaultValue="">
              <option value="" disabled>Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
            </select>
          </label>
          <label className={labelClass}>Project code
            <input className={inputClass} name="code" maxLength={50} placeholder="ARW-Q3-2026" />
          </label>
          <label className={labelClass}>Status
            <select className={inputClass} name="status" defaultValue="DRAFT">
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On hold</option>
            </select>
          </label>
          <label className={labelClass}>Start date *
            <input className={inputClass} type="date" name="startDate" required />
          </label>
          <label className={labelClass}>End date
            <input className={inputClass} type="date" name="endDate" />
          </label>
          <label className={`${labelClass} md:col-span-2`}>Description
            <textarea className="mt-1.5 min-h-24 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15" name="description" maxLength={2000} />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Commercial plan</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Set the value, cost expectation and target margin. These fields do not post accounting entries.</p>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <label className={labelClass}>Currency
            <input className={inputClass} name="currency" defaultValue={currency} maxLength={3} required />
          </label>
          <label className={labelClass}>Contract value *
            <input className={`${inputClass} tabular-nums`} name="contractValue" type="number" min="0" step="0.01" required defaultValue="0" />
          </label>
          <label className={labelClass}>Cost budget
            <input className={`${inputClass} tabular-nums`} name="costBudget" type="number" min="0" step="0.01" />
          </label>
          <label className={labelClass}>Margin target (%)
            <input className={`${inputClass} tabular-nums`} name="marginTarget" type="number" min="0" max="100" step="0.01" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Billing plan</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Optional planning milestones only. Leave all rows blank if billing is not yet planned. FINOS will not create invoices or recognise revenue from these milestones.</p>
        <div className="mt-6 overflow-hidden rounded-lg border border-[var(--app-border)]">
          <div className="grid grid-cols-[80px_1fr_1fr] gap-4 bg-[var(--surface-muted)] px-4 py-3 text-xs font-medium text-[var(--text-secondary)]">
            <span>Stage</span><span>Percentage</span><span>Expected billing date</span>
          </div>
          {[1, 2, 3].map((stage) => (
            <div key={stage} className="grid grid-cols-[80px_1fr_1fr] items-center gap-4 border-t border-[var(--app-border)] px-4 py-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">{stage}</span>
              <input aria-label={`Billing percentage ${stage}`} className="h-9 rounded-lg border border-[var(--app-border)] px-3 text-sm tabular-nums" name={`billingPercentage${stage}`} type="number" min="0" max="100" step="0.01" placeholder="e.g. 30" />
              <input aria-label={`Billing date ${stage}`} className="h-9 rounded-lg border border-[var(--app-border)] px-3 text-sm" name={`billingDate${stage}`} type="date" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Accounting defaults</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Optional project overrides. Organisation and item defaults remain available when these are blank.</p>
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <AccountSelect name="defaultIncomeAccountId" label="Default income account" options={incomeAccounts} />
          <AccountSelect name="contractAssetAccountId" label="Contract Asset account" options={assetAccounts} />
          <AccountSelect name="unearnedIncomeAccountId" label="Unearned Income account" options={liabilityAccounts} />
        </div>
      </section>

      <section className="rounded-xl border border-[var(--app-border)] bg-white p-6">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Notes and supporting documents</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Add commercial notes now. Contracts, purchase orders and evidence can be attached from the Project Documents tab after creation.</p>
        <textarea className="mt-5 min-h-28 w-full rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm outline-none focus:border-[var(--finos-accent)] focus:ring-2 focus:ring-[#16856F]/15" name="notes" maxLength={4000} />
      </section>

      <div className="flex items-center justify-end gap-3 pb-8">
        <Link href="/projects" className="flex h-10 items-center rounded-lg border border-[var(--app-border)] bg-white px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]">Cancel</Link>
        <button disabled={pending} className="h-10 rounded-lg bg-[var(--finos-accent)] px-5 text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? "Creating project…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

function AccountSelect({ name, label, options }: { name: string; label: string; options: Option[] }) {
  return (
    <label className={labelClass}>{label}
      <select className={inputClass} name={name} defaultValue="">
        <option value="">Use inherited default</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
