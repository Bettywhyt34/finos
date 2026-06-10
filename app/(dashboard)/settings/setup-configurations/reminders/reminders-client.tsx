"use client";

import { useState }           from "react";
import { Plus, X, Lock, AlertTriangle, Info } from "lucide-react";
import { toast }              from "sonner";
import type { ReminderRuleRow } from "@/lib/setup-configurations/service";
import { cn }                 from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_BASIS_LABELS: Record<string, string> = {
  DUE_DATE:               "due date",
  EXPECTED_PAYMENT_DATE:  "expected payment date",
  ISSUE_DATE:             "issue date",
};

function scheduleLabel(rule: ReminderRuleRow): string {
  const basis = TRIGGER_BASIS_LABELS[rule.triggerBasis] ?? rule.triggerBasis;
  if (rule.direction === "ON_DATE") return `On ${basis}`;
  const days = rule.offsetDays === 1 ? "1 day" : `${rule.offsetDays} days`;
  if (rule.direction === "BEFORE") return `${days} before ${basis}`;
  return `${days} after ${basis}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawerMode = "new" | "view" | "edit" | null;
type TabId      = "invoices" | "bills";

interface Props {
  initialRules: ReminderRuleRow[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RemindersClient({ initialRules }: Props) {
  const [rules,      setRules]      = useState<ReminderRuleRow[]>(initialRules);
  const [activeTab,  setActiveTab]  = useState<TabId>("invoices");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selected,   setSelected]   = useState<ReminderRuleRow | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [drawerError,setDrawerError]= useState<string | null>(null);

  // Form fields
  const [fieldName,         setFieldName]         = useState("");
  const [fieldEntityType,   setFieldEntityType]   = useState("INVOICE");
  const [fieldKind,         setFieldKind]         = useState("AUTOMATED");
  const [fieldTriggerBasis, setFieldTriggerBasis] = useState("DUE_DATE");
  const [fieldDirection,    setFieldDirection]    = useState("AFTER");
  const [fieldOffsetDays,   setFieldOffsetDays]   = useState("0");
  const [fieldDescription,  setFieldDescription]  = useState("");
  const [fieldSubject,      setFieldSubject]      = useState("");
  const [fieldBody,         setFieldBody]         = useState("");
  const [fieldIsActive,     setFieldIsActive]     = useState(false);

  // Derived rule lists
  const invoiceRules = rules.filter((r) => r.entityType === "INVOICE");
  const billRules    = rules.filter((r) => r.entityType === "BILL");
  const activeRules  = activeTab === "invoices" ? invoiceRules : billRules;

  const manualRules    = activeRules.filter((r) => r.kind === "MANUAL");
  const automatedRules = activeRules.filter((r) => r.kind === "AUTOMATED");

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resetForm() {
    setFieldName(""); setFieldEntityType(activeTab === "invoices" ? "INVOICE" : "BILL");
    setFieldKind("AUTOMATED"); setFieldTriggerBasis("DUE_DATE");
    setFieldDirection("AFTER"); setFieldOffsetDays("0");
    setFieldDescription(""); setFieldSubject(""); setFieldBody("");
    setFieldIsActive(false);
  }

  function openNew() {
    resetForm();
    setFieldEntityType(activeTab === "invoices" ? "INVOICE" : "BILL");
    setDrawerError(null); setSelected(null); setDrawerMode("new");
  }

  function openRule(row: ReminderRuleRow) {
    setSelected(row);
    if (row.isSystem) {
      setDrawerMode("view");
    } else {
      setFieldName(row.name);
      setFieldEntityType(row.entityType);
      setFieldKind(row.kind);
      setFieldTriggerBasis(row.triggerBasis);
      setFieldDirection(row.direction);
      setFieldOffsetDays(String(row.offsetDays));
      setFieldDescription(row.description ?? "");
      setFieldSubject(row.subject ?? "");
      setFieldBody(row.body ?? "");
      setFieldIsActive(row.isActive);
      setDrawerMode("edit");
    }
    setDrawerError(null);
  }

  function closeDrawer() {
    setDrawerMode(null); setSelected(null); setDrawerError(null);
  }

  function buildPayload() {
    return {
      entityType:   fieldEntityType,
      kind:         fieldKind,
      name:         fieldName.trim(),
      description:  fieldDescription.trim() || null,
      triggerBasis: fieldTriggerBasis,
      direction:    fieldDirection,
      offsetDays:   parseInt(fieldOffsetDays, 10) || 0,
      subject:      fieldSubject.trim() || null,
      body:         fieldBody.trim() || null,
      isActive:     fieldIsActive,
    };
  }

  function validate(): string | null {
    if (!fieldName.trim()) return "Reminder name is required.";
    const days = parseInt(fieldOffsetDays, 10);
    if (isNaN(days) || days < 0) return "Offset days must be a non-negative number.";
    if (
      fieldTriggerBasis === "EXPECTED_PAYMENT_DATE" &&
      fieldEntityType   !== "INVOICE"
    ) {
      return "Expected Payment Date basis is only valid for Invoice reminders.";
    }
    return null;
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    const err = validate();
    if (err) { setDrawerError(err); return; }

    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        "/api/settings/setup-configurations/reminders",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(buildPayload()),
        },
      );
      const json = await res.json() as { data?: ReminderRuleRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create reminder rule.");

      setRules((prev) => [...prev, json.data!]);
      toast.success("Reminder rule created.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  async function handleUpdate() {
    if (!selected) return;
    const err = validate();
    if (err) { setDrawerError(err); return; }

    setSaving(true); setDrawerError(null);
    try {
      const payload = {
        name:         fieldName.trim(),
        description:  fieldDescription.trim() || null,
        triggerBasis: fieldTriggerBasis,
        direction:    fieldDirection,
        offsetDays:   parseInt(fieldOffsetDays, 10) || 0,
        subject:      fieldSubject.trim() || null,
        body:         fieldBody.trim() || null,
        isActive:     fieldIsActive,
      };
      const res = await fetch(
        `/api/settings/setup-configurations/reminders/${selected.id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        },
      );
      const json = await res.json() as { data?: ReminderRuleRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update reminder rule.");

      setRules((prev) => prev.map((r) => (r.id === json.data!.id ? json.data! : r)));
      toast.success("Reminder rule updated.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!selected) return;
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/reminders/${selected.id}`,
        { method: "DELETE" },
      );
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete reminder rule.");

      setRules((prev) => prev.filter((r) => r.id !== selected.id));
      toast.success("Reminder rule deleted.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle isActive ──────────────────────────────────────────────────────────

  async function handleToggle(rule: ReminderRuleRow) {
    const newActive = !rule.isActive;
    // Optimistic update
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: newActive } : r)));
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/reminders/${rule.id}/toggle`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ isActive: newActive }),
        },
      );
      const json = await res.json() as { data?: ReminderRuleRow; error?: string };
      if (!res.ok) {
        // Revert on failure
        setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: rule.isActive } : r)));
        toast.error(json.error ?? "Failed to update reminder rule.");
      }
    } catch {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: rule.isActive } : r)));
      toast.error("Failed to update reminder rule.");
    }
  }

  // ── View-mode toggle (system rule) ──────────────────────────────────────────

  async function handleViewToggle(rule: ReminderRuleRow) {
    const newActive = !rule.isActive;
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/reminders/${rule.id}/toggle`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ isActive: newActive }),
        },
      );
      const json = await res.json() as { data?: ReminderRuleRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update.");
      setRules((prev) => prev.map((r) => (r.id === json.data!.id ? json.data! : r)));
      setSelected(json.data!);
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="px-8 py-8">

      {/* ── Page header ── */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Reminders</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-xl">
          Configure payment reminders for overdue invoices and upcoming bills.
        </p>
      </div>

      {/* ── Scheduler callout ── */}
      <div className="flex items-start gap-3 p-4 mb-6 bg-amber-50 border border-amber-200 rounded-lg">
        <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">
          Reminder rules are saved and will persist. Automated delivery will begin once the
          scheduler is connected to this account.
        </p>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-0 border-b border-slate-200 mb-6">
        {(["invoices", "bills"] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "border-[var(--finos-accent)] text-[var(--finos-accent)]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab === "invoices" ? "Invoices" : "Bills"}
          </button>
        ))}
      </div>

      {/* ── Manual Reminders ── */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Manual Reminders
        </h2>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-full">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {manualRules.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">
                      No manual reminder rules yet.
                    </td>
                  </tr>
                ) : (
                  manualRules.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openRule(row)}
                            className="text-[var(--finos-accent)] font-medium hover:underline text-left"
                          >
                            {row.name}
                          </button>
                          {row.isSystem && (
                            <Lock className="h-3 w-3 text-slate-400 shrink-0" aria-label="System rule" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                        {row.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openRule(row)}
                          className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
                        >
                          {row.isSystem ? "View" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Automated Reminders ── */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Automated Reminders
        </h2>
        <AutomatedTable
          rules={automatedRules}
          entityType={activeTab === "invoices" ? "INVOICE" : "BILL"}
          onOpen={openRule}
          onToggle={handleToggle}
        />
      </div>

      {/* ── New Reminder button ── */}
      <button
        type="button"
        onClick={openNew}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity"
      >
        <Plus className="h-4 w-4" />
        New Reminder
      </button>

      {/* ── Drawer ── */}
      {drawerMode && (
        <div className="fixed inset-0 z-[60] flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />

          {/* Panel */}
          <div className="w-[480px] bg-white h-full shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">
                {drawerMode === "new"  ? "New Reminder Rule"    :
                 drawerMode === "view" ? "Reminder Rule Details" :
                                        "Edit Reminder Rule"}
              </h2>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {/* Error banner */}
              {drawerError && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{drawerError}</p>
                </div>
              )}

              {/* ── VIEW mode (system rule) ── */}
              {drawerMode === "view" && selected && (
                <>
                  <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                    <p className="text-sm text-slate-500">
                      This is a system reminder rule. Core settings cannot be changed.
                    </p>
                  </div>

                  <DetailRow label="Name"          value={selected.name} />
                  <DetailRow label="Entity"        value={selected.entityType === "INVOICE" ? "Invoice" : "Bill"} />
                  <DetailRow label="Kind"          value={selected.kind === "MANUAL" ? "Manual" : "Automated"} />
                  {selected.kind === "AUTOMATED" && (
                    <DetailRow label="Schedule" value={scheduleLabel(selected)} />
                  )}
                  {selected.description && (
                    <DetailRow label="Description" value={selected.description} />
                  )}

                  {/* isActive toggle for system rules */}
                  <div className="flex items-center justify-between py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-500">Active</span>
                    <ToggleSwitch
                      checked={selected.isActive}
                      disabled={saving}
                      onChange={() => handleViewToggle(selected)}
                    />
                  </div>

                  {selected.subject && (
                    <DetailRow label="Email Subject" value={selected.subject} />
                  )}
                </>
              )}

              {/* ── NEW / EDIT mode ── */}
              {(drawerMode === "new" || drawerMode === "edit") && (
                <>
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder="e.g. 7-Day Overdue Notice"
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    />
                  </div>

                  {/* Entity Type — show in new mode only */}
                  {drawerMode === "new" && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Applies To
                      </label>
                      <select
                        value={fieldEntityType}
                        onChange={(e) => {
                          setFieldEntityType(e.target.value);
                          if (e.target.value === "BILL" && fieldTriggerBasis === "EXPECTED_PAYMENT_DATE") {
                            setFieldTriggerBasis("DUE_DATE");
                          }
                        }}
                        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                      >
                        <option value="INVOICE">Invoices</option>
                        <option value="BILL">Bills</option>
                      </select>
                    </div>
                  )}

                  {/* Kind */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Kind
                    </label>
                    <select
                      value={fieldKind}
                      onChange={(e) => setFieldKind(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    >
                      <option value="MANUAL">Manual</option>
                      <option value="AUTOMATED">Automated</option>
                    </select>
                  </div>

                  {/* Schedule fields — only for AUTOMATED */}
                  {fieldKind === "AUTOMATED" && (
                    <>
                      {/* Trigger Basis */}
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                          Trigger Basis
                        </label>
                        <select
                          value={fieldTriggerBasis}
                          onChange={(e) => setFieldTriggerBasis(e.target.value)}
                          className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                        >
                          <option value="DUE_DATE">Due Date</option>
                          {fieldEntityType === "INVOICE" && (
                            <option value="EXPECTED_PAYMENT_DATE">Expected Payment Date</option>
                          )}
                          <option value="ISSUE_DATE">Issue Date</option>
                        </select>
                      </div>

                      {/* Direction */}
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                          Direction
                        </label>
                        <select
                          value={fieldDirection}
                          onChange={(e) => setFieldDirection(e.target.value)}
                          className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                        >
                          <option value="BEFORE">Before</option>
                          <option value="ON_DATE">On Date</option>
                          <option value="AFTER">After</option>
                        </select>
                      </div>

                      {/* Offset Days — hide when ON_DATE */}
                      {fieldDirection !== "ON_DATE" && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            Offset Days
                          </label>
                          <input
                            type="number"
                            value={fieldOffsetDays}
                            min={0}
                            onChange={(e) => setFieldOffsetDays(e.target.value)}
                            placeholder="e.g. 7"
                            className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                          />
                          {fieldOffsetDays && parseInt(fieldOffsetDays, 10) >= 0 && (
                            <p className="mt-1 text-xs text-slate-400">
                              Preview: {scheduleLabel({
                                triggerBasis: fieldTriggerBasis,
                                direction:    fieldDirection,
                                offsetDays:   parseInt(fieldOffsetDays, 10) || 0,
                              } as ReminderRuleRow)}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Description <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={fieldDescription}
                      onChange={(e) => setFieldDescription(e.target.value)}
                      placeholder="Short description of this reminder"
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    />
                  </div>

                  {/* Email subject */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Email Subject <span className="text-slate-400 font-normal">(optional — for future delivery)</span>
                    </label>
                    <input
                      type="text"
                      value={fieldSubject}
                      onChange={(e) => setFieldSubject(e.target.value)}
                      placeholder="e.g. Friendly reminder: invoice #{{number}} is overdue"
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    />
                  </div>

                  {/* Email body */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Email Body <span className="text-slate-400 font-normal">(optional — for future delivery)</span>
                    </label>
                    <textarea
                      value={fieldBody}
                      onChange={(e) => setFieldBody(e.target.value)}
                      rows={4}
                      placeholder="Write the reminder message body here…"
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 resize-none"
                    />
                  </div>

                  {/* Active toggle */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-medium text-slate-700">Active</span>
                    <ToggleSwitch
                      checked={fieldIsActive}
                      onChange={() => setFieldIsActive((v) => !v)}
                    />
                  </label>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">

              {/* Left — delete (edit mode, custom rules only) */}
              <div>
                {drawerMode === "edit" && selected && !selected.isSystem && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="text-sm text-slate-500 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>

              {/* Right */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {drawerMode === "view" ? "Close" : "Cancel"}
                </button>

                {drawerMode !== "view" && (
                  <button
                    type="button"
                    onClick={drawerMode === "new" ? handleCreate : handleUpdate}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {saving ? "Saving…" : drawerMode === "new" ? "Create" : "Save Changes"}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Automated Rules Table ────────────────────────────────────────────────────

function AutomatedTable({
  rules,
  entityType,
  onOpen,
  onToggle,
}: {
  rules:      ReminderRuleRow[];
  entityType: "INVOICE" | "BILL";
  onOpen:     (row: ReminderRuleRow) => void;
  onToggle:   (row: ReminderRuleRow) => void;
}) {
  // For INVOICE: group into "Based on Expected Payment Date" and "Based on Due Date"
  // For BILL: just show all rules flat
  if (entityType === "BILL" || rules.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-full">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Schedule</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                    No automated reminder rules yet.
                  </td>
                </tr>
              ) : (
                rules.map((row) => (
                  <AutomatedRow key={row.id} row={row} onOpen={onOpen} onToggle={onToggle} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // INVOICE: grouped
  const expectedRules = rules.filter((r) => r.triggerBasis === "EXPECTED_PAYMENT_DATE");
  const dueDateRules  = rules.filter((r) => r.triggerBasis !== "EXPECTED_PAYMENT_DATE");

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-full">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Schedule</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expectedRules.length > 0 && (
              <>
                <tr className="bg-slate-50/70 border-b border-slate-100">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Based on Expected Payment Date
                  </td>
                </tr>
                {expectedRules.map((row) => (
                  <AutomatedRow key={row.id} row={row} onOpen={onOpen} onToggle={onToggle} />
                ))}
              </>
            )}
            {dueDateRules.length > 0 && (
              <>
                <tr className="bg-slate-50/70 border-b border-slate-100">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Based on Due Date
                  </td>
                </tr>
                {dueDateRules.map((row) => (
                  <AutomatedRow key={row.id} row={row} onOpen={onOpen} onToggle={onToggle} />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AutomatedRow({
  row,
  onOpen,
  onToggle,
}: {
  row:      ReminderRuleRow;
  onOpen:   (row: ReminderRuleRow) => void;
  onToggle: (row: ReminderRuleRow) => void;
}) {
  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="text-[var(--finos-accent)] font-medium hover:underline text-left"
          >
            {row.name}
          </button>
          {row.isSystem && (
            <Lock className="h-3 w-3 text-slate-400 shrink-0" aria-label="System rule" />
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
        {scheduleLabel(row)}
      </td>
      <td className="px-4 py-3 text-center">
        <ToggleSwitch checked={row.isActive} onChange={() => onToggle(row)} />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          {row.isSystem ? "View" : "Edit"}
        </button>
      </td>
    </tr>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked:   boolean;
  disabled?: boolean;
  onChange:  () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/30 disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-[var(--finos-accent)]" : "bg-slate-300"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// ─── Detail row helper ────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}
