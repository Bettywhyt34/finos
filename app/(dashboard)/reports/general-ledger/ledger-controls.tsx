"use client";

import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = { id: string; label: string };
type TagGroup = { id: string; name: string; options: Option[] };

interface LedgerControlsProps {
  accounts: Option[];
  projects: Option[];
  tagGroups: TagGroup[];
  sourceOptions: Option[];
  initial: {
    accountId: string;
    range: string;
    dateFrom: string;
    dateTo: string;
    projectId: string;
    tagOptionId: string;
    source: string;
    party: string;
  };
}

const RANGE_OPTIONS = [
  ["TODAY", "Today"],
  ["THIS_MONTH", "This Month"],
  ["LAST_MONTH", "Last Month"],
  ["THIS_QUARTER", "This Quarter"],
  ["LAST_QUARTER", "Last Quarter"],
  ["THIS_YEAR", "This Year"],
  ["LAST_YEAR", "Last Year"],
  ["CUSTOM", "Custom"],
] as const;

export function LedgerControls({ accounts, projects, tagGroups, sourceOptions, initial }: LedgerControlsProps) {
  const [range, setRange] = useState(initial.range || "THIS_YEAR");
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(initial.projectId || initial.tagOptionId || initial.source || initial.party)
  );

  const activeFilterCount = [initial.projectId, initial.tagOptionId, initial.source, initial.party]
    .filter(Boolean).length;

  const clearHref = `/reports/general-ledger?accountId=${encodeURIComponent(initial.accountId)}&range=${encodeURIComponent(range)}`;

  return (
    <form method="GET" className="space-y-3">
      <input type="hidden" name="accountId" value={initial.accountId} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select name="range" value={range} onValueChange={(value) => setRange(value ?? "THIS_YEAR")}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {range === "CUSTOM" && (
            <>
              <Input type="date" name="dateFrom" defaultValue={initial.dateFrom} className="h-9 w-auto" required />
              <span className="text-sm text-slate-400">to</span>
              <Input type="date" name="dateTo" defaultValue={initial.dateTo} className="h-9 w-auto" required />
            </>
          )}

          <Button type="submit" variant="outline" size="sm">Apply</Button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen((open) => !open)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Account</label>
              <Select name="accountFilter" defaultValue={initial.accountId}>
                <SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Project</label>
              <Select name="projectId" defaultValue={initial.projectId || "ALL"}>
                <SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Projects</SelectItem>
                  {projects.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Reporting Tag</label>
              <Select name="tagOptionId" defaultValue={initial.tagOptionId || "ALL"}>
                <SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Reporting Tags</SelectItem>
                  {tagGroups.flatMap((tag) => tag.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{tag.name}: {option.label}</SelectItem>
                  )))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Transaction Type</label>
              <Select name="source" defaultValue={initial.source || "ALL"}>
                <SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Transaction Types</SelectItem>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Party</label>
              <Input name="party" defaultValue={initial.party} placeholder="Customer or vendor..." className="bg-white" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <a href={clearHref} className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-slate-500 hover:bg-white hover:text-slate-900">
              <X className="h-4 w-4" /> Clear Filters
            </a>
            <Button type="submit" size="sm">Apply Filters</Button>
          </div>
        </div>
      )}
    </form>
  );
}
