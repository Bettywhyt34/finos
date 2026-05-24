"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";

const TIMEZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
];

const COUNTRIES = [
  { code: "NG", name: "Nigeria" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "ZA", name: "South Africa" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SG", name: "Singapore" },
];

const INDUSTRIES = [
  { code: "retail",      name: "Retail" },
  { code: "wholesale",   name: "Wholesale / Distribution" },
  { code: "manufacturing", name: "Manufacturing" },
  { code: "services",    name: "Professional Services" },
  { code: "hospitality", name: "Hospitality & Food" },
  { code: "tech",        name: "Technology" },
  { code: "finance",     name: "Financial Services" },
  { code: "healthcare",  name: "Healthcare" },
  { code: "ngo",         name: "Non-Profit / NGO" },
  { code: "other",       name: "Other" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  tenant: {
    id: string;
    name: string;
    currency: string;
    countryCode: string;
    fiscalYearStart: number;
    timezone: string;
    industryCode: string | null;
  };
}

export default function OrgForm({ tenant }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name:            tenant.name,
    currency:        tenant.currency,
    countryCode:     tenant.countryCode,
    fiscalYearStart: tenant.fiscalYearStart,
    timezone:        tenant.timezone,
    industryCode:    tenant.industryCode ?? "",
  });

  const set = (key: string, val: string | number) =>
    setForm((f) => ({ ...f, [key]: val }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:            form.name,
          currency:        form.currency,
          countryCode:     form.countryCode,
          fiscalYearStart: Number(form.fiscalYearStart),
          timezone:        form.timezone,
          industryCode:    form.industryCode || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Organisation settings saved.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error saving settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Organisation Name */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          General
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-name">Organisation Name</Label>
            <Input
              id="org-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Acme Ltd"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <Select
              value={form.countryCode}
              onValueChange={(v) => set("countryCode", v ?? "NG")}
            >
              <SelectTrigger id="country">
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="industry">Industry</Label>
            <Select
              value={form.industryCode}
              onValueChange={(v) => set("industryCode", v ?? "")}
            >
              <SelectTrigger id="industry">
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((i) => (
                  <SelectItem key={i.code} value={i.code}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Financial Settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Financial Settings
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="currency">Base Currency</Label>
            <Select
              value={form.currency}
              onValueChange={(v) => set("currency", v ?? "NGN")}
            >
              <SelectTrigger id="currency">
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fiscal">Fiscal Year Start</Label>
            <Select
              value={String(form.fiscalYearStart)}
              onValueChange={(v) => set("fiscalYearStart", Number(v ?? "1"))}
            >
              <SelectTrigger id="fiscal">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              value={form.timezone}
              onValueChange={(v) => set("timezone", v ?? "Africa/Lagos")}
            >
              <SelectTrigger id="timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
