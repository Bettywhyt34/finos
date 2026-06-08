"use client";

import { useState, useEffect } from "react";
import { toast }               from "sonner";
import { Info, Save }          from "lucide-react";
import { Button }              from "@/components/ui/button";
import { Input }               from "@/components/ui/input";
import { Label }               from "@/components/ui/label";
import { cn }                  from "@/lib/utils";
import { getTaxSettings, updateTaxSettings, TaxSettings } from "@/lib/taxes/service";

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)] focus:ring-offset-1",
        checked ? "bg-[var(--finos-accent)]" : "bg-slate-200",
      )}
    >
      <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </button>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
        <div className="h-px bg-slate-200 mt-2" />
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: TaxSettings = {
  taxRegistrationLabel:   "VAT Reg No",
  taxRegistrationNumber:  "",
  whtEnabled:             true,
  reverseChargeSales:     false,
  reverseChargePurchases: false,
  trackingMode:           "single",
  overrideSales:          false,
  overridePurchases:      false,
};

// ─── Main component ───────────────────────────────────────────────────────────

export function TaxSettingsClient() {
  const [settings, setSettings] = useState<TaxSettings>(DEFAULTS);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    getTaxSettings()
      .then((s) => setSettings({ ...DEFAULTS, ...s }))
      .catch(() => { /* silently use defaults */ });
  }, []);

  function patch<K extends keyof TaxSettings>(key: K, value: TaxSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateTaxSettings(settings);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Tax settings backend is not connected yet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-8 py-7 max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-[17px] font-semibold text-slate-800">Tax Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure tax registration, WHT, reverse charge, and tracking preferences.
        </p>
      </div>

      {/* Info callout */}
      <div className="flex gap-3 px-4 py-3 rounded-lg border border-blue-100 bg-blue-50">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[13px] text-blue-700">
          These preferences will be saved once the tax settings backend is enabled.
        </p>
      </div>

      {/* 1. Tax Registration */}
      <Section title="Tax Registration">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="reg-label">Label</Label>
            <select
              id="reg-label"
              value={settings.taxRegistrationLabel}
              onChange={(e) => patch("taxRegistrationLabel", e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
            >
              <option>VAT Reg No</option>
              <option>FIRS TIN</option>
              <option>Business No</option>
              <option>Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-number">Registration Number</Label>
            <Input
              id="reg-number"
              value={settings.taxRegistrationNumber}
              onChange={(e) => patch("taxRegistrationNumber", e.target.value)}
              placeholder="e.g. 12345678-0001"
            />
          </div>
        </div>
      </Section>

      {/* 2. WHT */}
      <Section title="Withholding Tax (WHT)">
        <ToggleRow
          label="Enable Withholding Tax"
          description="WHT can be associated with customers, vendors, or specific transactions."
          checked={settings.whtEnabled}
          onChange={(v) => patch("whtEnabled", v)}
        />
      </Section>

      {/* 3. Reverse Charge */}
      <Section title="Reverse Charge">
        <p className="text-xs text-slate-400">
          Reverse charge shifts VAT liability to the buyer (common for cross-border B2B services).
        </p>
        <ToggleRow
          label="Apply reverse charge on sales"
          checked={settings.reverseChargeSales}
          onChange={(v) => patch("reverseChargeSales", v)}
        />
        <ToggleRow
          label="Apply reverse charge on purchases"
          checked={settings.reverseChargePurchases}
          onChange={(v) => patch("reverseChargePurchases", v)}
        />
      </Section>

      {/* 4. Tax Tracking Account */}
      <Section title="Tax Tracking Account">
        <div className="space-y-2">
          {(["single", "separate"] as const).map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <input
                type="radio"
                name="trackingMode"
                value={mode}
                checked={settings.trackingMode === mode}
                onChange={() => patch("trackingMode", mode)}
                className="accent-[var(--finos-accent)]"
              />
              <div>
                <p className="text-sm font-medium text-slate-700 capitalize">
                  {mode === "single" ? "Single tax account" : "Separate accounts per tax type"}
                </p>
                <p className="text-xs text-slate-400">
                  {mode === "single"
                    ? "All taxes post to one liability account."
                    : "VAT, WHT, PAYE each post to their own account."}
                </p>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {/* 5. Tax Override */}
      <Section title="Tax Override">
        <ToggleRow
          label="Allow tax override on sales"
          description="Users can manually override the calculated tax on sales documents."
          checked={settings.overrideSales}
          onChange={(v) => patch("overrideSales", v)}
        />
        <ToggleRow
          label="Allow tax override on purchases"
          description="Users can manually override the calculated tax on purchase documents."
          checked={settings.overridePurchases}
          onChange={(v) => patch("overridePurchases", v)}
        />
      </Section>

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
