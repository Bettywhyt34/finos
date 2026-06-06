"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin, Building2, Warehouse, GitBranch, Plus,
  CheckCircle2, Info, X, Pencil, Trash2, PowerOff,
  AlertTriangle, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  SettingsHeader,
  SettingsSidebar,
  SectionTitle,
  RightUtilityDock,
  AssistanceButton,
} from "@/components/settings/settings-shell";
import {
  enableLocations,
  addLocation,
  updateLocation,
  toggleLocationStatus,
  deleteLocation,
  type LocationInput,
} from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type LocType   = "BUSINESS_LOCATION" | "WAREHOUSE" | "BRANCH";
type LocStatus = "ACTIVE" | "INACTIVE";

interface Location {
  id:       string;
  name:     string;
  type:     LocType;
  parentId: string | null;
  address:  string | null;
  city:     string | null;
  state:    string | null;
  country:  string | null;
  status:   LocStatus;
}

interface Props {
  orgName:          string;
  locationsEnabled: boolean;
  locations:        Location[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<LocType, string> = {
  BUSINESS_LOCATION: "Business Location",
  WAREHOUSE:         "Warehouse",
  BRANCH:            "Branch",
};

const TYPE_ICONS: Record<LocType, React.ComponentType<{ className?: string }>> = {
  BUSINESS_LOCATION: MapPin,
  WAREHOUSE:         Warehouse,
  BRANCH:            GitBranch,
};

const PLACEHOLDER: Location[] = [
  { id: "ph-a", name: "Location A", type: "BUSINESS_LOCATION", parentId: null,   address: null, city: null, state: null, country: null, status: "ACTIVE" },
  { id: "ph-b", name: "Location B", type: "BUSINESS_LOCATION", parentId: null,   address: null, city: null, state: null, country: null, status: "ACTIVE" },
  { id: "ph-c", name: "Location C", type: "WAREHOUSE",         parentId: "ph-a", address: null, city: null, state: null, country: null, status: "ACTIVE" },
  { id: "ph-d", name: "Location D", type: "WAREHOUSE",         parentId: "ph-a", address: null, city: null, state: null, country: null, status: "ACTIVE" },
  { id: "ph-e", name: "Location E", type: "BRANCH",            parentId: "ph-b", address: null, city: null, state: null, country: null, status: "ACTIVE" },
];

// ─── Illustration ─────────────────────────────────────────────────────────────

function LocationIllustration() {
  return (
    <svg viewBox="0 0 220 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <ellipse cx="110" cy="160" rx="88" ry="13" fill="#f1f5f9"/>
      <ellipse cx="110" cy="160" rx="62" ry="8"  fill="#e2e8f0" opacity="0.7"/>
      {/* Small pin 1 */}
      <path d="M55 118 C55 118 47 108 47 102 C47 95.9 50.7 91 55 91 C59.3 91 63 95.9 63 102 C63 108 55 118 55 118Z" fill="#cbd5e1"/>
      <circle cx="55" cy="102" r="4" fill="white" opacity="0.85"/>
      {/* Small pin 2 */}
      <path d="M168 106 C168 106 162 98 162 93 C162 88.5 164.7 85 168 85 C171.3 85 174 88.5 174 93 C174 98 168 106 168 106Z" fill="#cbd5e1"/>
      <circle cx="168" cy="93" r="3.5" fill="white" opacity="0.85"/>
      {/* Large red pin */}
      <path d="M110 140 C110 140 83 114 83 92 C83 77 95.6 65 110 65 C124.4 65 137 77 137 92 C137 114 110 140 110 140Z" fill="#f87171" opacity="0.88"/>
      <circle cx="110" cy="92" r="11" fill="white"/>
      <circle cx="110" cy="92" r="5"  fill="#ef4444" opacity="0.55"/>
    </svg>
  );
}

// ─── Tree node cards ──────────────────────────────────────────────────────────

function OrgNode({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white border-2 border-blue-200 rounded-lg shadow-sm">
      <div className="w-7 h-7 rounded bg-blue-50 flex items-center justify-center shrink-0">
        <Building2 className="h-3.5 w-3.5 text-blue-500" />
      </div>
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide leading-none">Your Organisation</p>
        <p className="text-[12px] font-semibold text-slate-800 mt-0.5 max-w-[140px] truncate">{name}</p>
      </div>
    </div>
  );
}

function LocNodeCard({
  node,
  onClick,
  muted = false,
}: {
  node: Pick<Location, "id" | "name" | "type" | "status">;
  onClick?: () => void;
  muted?: boolean;
}) {
  const Icon = TYPE_ICONS[node.type];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={muted}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all w-full",
        muted
          ? "bg-slate-50 border-slate-200 opacity-45 cursor-default"
          : "bg-white border-blue-200 hover:border-blue-400 hover:shadow-sm cursor-pointer"
      )}
    >
      <div className={cn("w-6 h-6 rounded flex items-center justify-center shrink-0", muted ? "bg-slate-100" : "bg-blue-50")}>
        <Icon className={cn("h-3 w-3", muted ? "text-slate-400" : "text-blue-500")} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[10px] font-bold uppercase tracking-wide leading-none truncate", muted ? "text-slate-400" : "text-slate-700")}>
          {node.name}
        </p>
        <p className={cn("text-[10px] mt-0.5", muted ? "text-slate-300" : "text-slate-400")}>
          {TYPE_LABELS[node.type]}
        </p>
        {!muted && node.status === "INACTIVE" && (
          <span className="text-[9px] text-amber-600 font-medium">Inactive</span>
        )}
      </div>
    </button>
  );
}

// ─── Tree layout ──────────────────────────────────────────────────────────────

/**
 * Renders a horizontal row of sibling nodes connected by a dashed bus line.
 * Each node column has a T-junction connector at the top:
 *   [left half border-t] [zero-width border-l vertical drop] [right half border-t]
 * The left half is invisible for the first sibling; right half invisible for the last.
 */
function SiblingRow({
  nodes,
  onSelect,
  muted = false,
}: {
  nodes: Location[];
  onSelect?: (l: Location) => void;
  muted?: boolean;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="flex justify-center">
      {nodes.map((node, i) => (
        <div key={node.id} className="flex flex-col items-center" style={{ minWidth: 136 }}>
          {/* T-connector */}
          <div className="flex w-full">
            <div className={cn("flex-1 h-8 border-t-2 border-dashed border-blue-200", i === 0 && "opacity-0")} />
            <div className="w-0 h-8 border-l-2 border-dashed border-blue-200" />
            <div className={cn("flex-1 h-8 border-t-2 border-dashed border-blue-200", i === nodes.length - 1 && "opacity-0")} />
          </div>
          <div style={{ width: 120 }}>
            <LocNodeCard node={node} onClick={() => !muted && onSelect?.(node)} muted={muted} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LocationTree({
  orgName,
  locations,
  onSelect,
  muted = false,
}: {
  orgName: string;
  locations: Location[];
  onSelect?: (l: Location) => void;
  muted?: boolean;
}) {
  const l1 = locations.filter((l) => !l.parentId);
  const childrenOf = (pid: string) => locations.filter((l) => l.parentId === pid);

  return (
    <div className="flex flex-col items-center pt-10 pb-12 overflow-x-auto">
      <OrgNode name={orgName} />

      {l1.length === 0 && !muted && (
        <p className="text-sm text-slate-400 mt-8">
          No locations yet. Click &ldquo;Add Location&rdquo; to get started.
        </p>
      )}

      {l1.length > 0 && (
        <>
          {/* Trunk from org down to L1 bus */}
          <div className="w-0 h-8 border-l-2 border-dashed border-blue-200" />

          {/* L1 row — each column contains the L1 node + its L2 children below */}
          <div className="flex justify-center">
            {l1.map((parent, i) => {
              const kids = childrenOf(parent.id);
              return (
                <div key={parent.id} className="flex flex-col items-center" style={{ minWidth: 136 }}>
                  {/* T-connector for this L1 */}
                  <div className="flex w-full">
                    <div className={cn("flex-1 h-8 border-t-2 border-dashed border-blue-200", i === 0 && "opacity-0")} />
                    <div className="w-0 h-8 border-l-2 border-dashed border-blue-200" />
                    <div className={cn("flex-1 h-8 border-t-2 border-dashed border-blue-200", i === l1.length - 1 && "opacity-0")} />
                  </div>

                  {/* L1 node */}
                  <div style={{ width: 120 }}>
                    <LocNodeCard node={parent} onClick={() => !muted && onSelect?.(parent)} muted={muted} />
                  </div>

                  {/* L2 children of this L1 */}
                  {kids.length > 0 && (
                    <>
                      <div className="w-0 h-6 border-l-2 border-dashed border-blue-200" />
                      <div className="flex justify-center">
                        {kids.map((child, j) => (
                          <div key={child.id} className="flex flex-col items-center" style={{ minWidth: 120 }}>
                            <div className="flex w-full">
                              <div className={cn("flex-1 h-6 border-t-2 border-dashed border-blue-200", j === 0 && "opacity-0")} />
                              <div className="w-0 h-6 border-l-2 border-dashed border-blue-200" />
                              <div className={cn("flex-1 h-6 border-t-2 border-dashed border-blue-200", j === kids.length - 1 && "opacity-0")} />
                            </div>
                            <div style={{ width: 108 }}>
                              <LocNodeCard node={child} onClick={() => !muted && onSelect?.(child)} muted={muted} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Enable modal ─────────────────────────────────────────────────────────────

function EnableModal({ onClose, onConfirm, loading }: { onClose: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-900">Enable Locations</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          Once locations are enabled, you won&apos;t be able to disable them later. You can create
          locations for branches and warehouses and manage location-specific transactions.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] hover:bg-blue-600 rounded-md transition-colors disabled:opacity-60">
            {loading ? "Enabling…" : "Enable Locations"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Location form modal ──────────────────────────────────────────────────────

const EMPTY_FORM: LocationInput = {
  name: "", type: "BUSINESS_LOCATION", parentId: null,
  address: "", city: "", state: "", country: "",
};

function LocationFormModal({
  mode,
  initial,
  locations,
  onClose,
  onSave,
  loading,
}: {
  mode:      "add" | "edit";
  initial:   LocationInput & { id?: string };
  locations: Location[];
  onClose:   () => void;
  onSave:    (data: LocationInput) => void;
  loading:   boolean;
}) {
  const [form, setForm] = useState<LocationInput>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof LocationInput, string>>>({});

  function setField<K extends keyof LocationInput>(k: K, v: LocationInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!form.name.trim())    errs.name    = "Location name is required";
    if (!form.city?.trim())   errs.city    = "City is required";
    if (!form.country?.trim()) errs.country = "Country is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSave(form);
  }

  const parentOptions = locations.filter((l) => !l.parentId && l.id !== (initial as any).id);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-900">{mode === "add" ? "Add Location" : "Edit Location"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Location Name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)}
              className={cn("w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25",
                errors.name ? "border-red-400" : "border-slate-200")}
              placeholder="e.g. Lagos Head Office" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Location Type <span className="text-red-500">*</span></label>
            <div className="relative">
              <select value={form.type} onChange={(e) => setField("type", e.target.value as LocType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 appearance-none bg-white">
                <option value="BUSINESS_LOCATION">Business Location</option>
                <option value="WAREHOUSE">Warehouse</option>
                <option value="BRANCH">Branch</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Parent */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Parent Location</label>
            <div className="relative">
              <select value={form.parentId ?? ""} onChange={(e) => setField("parentId", e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 appearance-none bg-white">
                <option value="">None (top-level)</option>
                {parentOptions.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
            <input value={form.address ?? ""} onChange={(e) => setField("address", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
              placeholder="Street address" />
          </div>

          {/* City / State */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City <span className="text-red-500">*</span></label>
              <input value={form.city ?? ""} onChange={(e) => setField("city", e.target.value)}
                className={cn("w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25",
                  errors.city ? "border-red-400" : "border-slate-200")}
                placeholder="City" />
              {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State / Region</label>
              <input value={form.state ?? ""} onChange={(e) => setField("state", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                placeholder="State" />
            </div>
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Country <span className="text-red-500">*</span></label>
            <input value={form.country ?? ""} onChange={(e) => setField("country", e.target.value)}
              className={cn("w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25",
                errors.country ? "border-red-400" : "border-slate-200")}
              placeholder="e.g. Nigeria" />
            {errors.country && <p className="text-xs text-red-500 mt-1">{errors.country}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] hover:bg-blue-600 rounded-md transition-colors disabled:opacity-60">
            {loading ? "Saving…" : "Save Location"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Location detail modal ────────────────────────────────────────────────────

function LocationDetailModal({
  location,
  allLocations,
  onClose,
  onEdit,
  onToggleStatus,
  onDelete,
  loading,
}: {
  location:     Location;
  allLocations: Location[];
  onClose:      () => void;
  onEdit:       () => void;
  onToggleStatus: () => void;
  onDelete:     () => void;
  loading:      boolean;
}) {
  const parent = allLocations.find((l) => l.id === location.parentId);
  const hasChildren = allLocations.some((l) => l.parentId === location.id);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              {(() => { const Icon = TYPE_ICONS[location.type]; return <Icon className="h-4 w-4 text-blue-500" />; })()}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">{location.name}</h2>
              <p className="text-xs text-slate-500">{TYPE_LABELS[location.type]}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="divide-y divide-slate-100 text-sm">
          <Row label="Status">
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", location.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
              {location.status === "ACTIVE" ? "Active" : "Inactive"}
            </span>
          </Row>
          <Row label="Parent">{parent ? parent.name : "Your Organisation"}</Row>
          {location.address && <Row label="Address">{location.address}</Row>}
          {location.city    && <Row label="City">{location.city}{location.state ? `, ${location.state}` : ""}</Row>}
          {location.country && <Row label="Country">{location.country}</Row>}
        </div>

        {hasChildren && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>This location has sub-locations. Remove them before deleting.</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            <button onClick={onEdit} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
              <Pencil className="h-3 w-3" /> Edit
            </button>
            <button onClick={onToggleStatus} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
              <PowerOff className="h-3 w-3" />
              {location.status === "ACTIVE" ? "Mark Inactive" : "Mark Active"}
            </button>
          </div>
          <button onClick={onDelete} disabled={loading || hasChildren}
            title={hasChildren ? "Remove sub-locations first" : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start py-2 gap-4">
      <span className="text-slate-400 text-xs w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-slate-700 text-sm">{children}</span>
    </div>
  );
}

// ─── Benefits card ────────────────────────────────────────────────────────────

const BENEFITS = [
  "Monitor Item Stocks",
  "Separate Billing and Storage",
  "Unique Transaction Numbers",
  "Location-specific Accounting",
];

function BenefitsCard() {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden w-full max-w-[760px]">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--finos-accent)]" />
        <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Key Benefits</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-1 gap-0 divide-y divide-slate-100">
        {BENEFITS.map((b, i) => (
          <div key={b} className={cn("flex items-center gap-2.5 px-4 py-2.5", i % 2 === 0 ? "" : "")}>
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--finos-accent)] shrink-0" />
            <span className="text-sm text-slate-700">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Points to note ───────────────────────────────────────────────────────────

function PointsToNote() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 w-full max-w-[760px]">
      <div className="flex items-center gap-2 mb-3">
        <Info className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Points to Note</span>
      </div>
      <ul className="space-y-1.5 pl-1">
        {[
          "Once you enable Locations, you won't be able to disable it.",
          "You can delete a location if it hasn't been used in transactions, or mark it as inactive.",
          "You can manage multiple warehouses under a single location.",
        ].map((pt) => (
          <li key={pt} className="flex items-start gap-2 text-sm text-amber-800">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
            {pt}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LocationsClient({ orgName, locationsEnabled, locations }: Props) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["organization"]));

  // Modals
  const [showEnable,   setShowEnable]   = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [formMode,     setFormMode]     = useState<"add" | "edit">("add");
  const [formInitial,  setFormInitial]  = useState<LocationInput & { id?: string }>(EMPTY_FORM);
  const [selected,     setSelected]     = useState<Location | null>(null);

  const [isPending, startTransition] = useTransition();

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape" && search) setSearch("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleEnable() {
    startTransition(async () => {
      try {
        await enableLocations();
        setShowEnable(false);
        toast.success("Locations enabled.");
        router.refresh();
      } catch (e: any) {
        toast.error(e.message ?? "Failed to enable locations.");
      }
    });
  }

  function openAdd() {
    setFormMode("add");
    setFormInitial(EMPTY_FORM);
    setSelected(null);
    setShowForm(true);
  }

  function openEdit(loc: Location) {
    setFormMode("edit");
    setFormInitial({ id: loc.id, name: loc.name, type: loc.type, parentId: loc.parentId, address: loc.address ?? "", city: loc.city ?? "", state: loc.state ?? "", country: loc.country ?? "" });
    setSelected(null);
    setShowForm(true);
  }

  function handleSave(data: LocationInput) {
    startTransition(async () => {
      try {
        if (formMode === "add") {
          await addLocation(data);
          toast.success("Location added.");
        } else {
          await updateLocation(formInitial.id!, data);
          toast.success("Location updated.");
        }
        setShowForm(false);
        router.refresh();
      } catch (e: any) {
        toast.error(e.message ?? "Failed to save location.");
      }
    });
  }

  function handleToggleStatus() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await toggleLocationStatus(selected.id);
        setSelected(null);
        toast.success("Location status updated.");
        router.refresh();
      } catch (e: any) {
        toast.error(e.message ?? "Failed to update status.");
      }
    });
  }

  function handleDelete() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await deleteLocation(selected.id);
        setSelected(null);
        toast.success("Location deleted.");
        router.refresh();
      } catch (e: any) {
        toast.error(e.message ?? e);
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const treeLocations = locationsEnabled ? locations : PLACEHOLDER;

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f8fb] flex flex-col">

      <SettingsHeader
        orgName={orgName}
        breadcrumb="Locations"
        search={search}
        onSearch={setSearch}
        onClose={() => router.push("/settings")}
        searchRef={searchRef}
      />

      <div className="flex flex-1 overflow-hidden">
        <SettingsSidebar
          search={search}
          expanded={expanded}
          onToggle={toggleExpanded}
          activeItem="locations"
        />

        <main className="flex-1 overflow-y-auto">
          <div className="px-10 py-7 max-w-[900px] space-y-6">

            {/* Page title */}
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Locations</h1>
              <div className="h-px bg-slate-200 mt-3" />
            </div>

            {/* ── Intro row ── */}
            <section className="flex items-start gap-8">
              <div className="flex-1 space-y-4">
                <div className="space-y-1.5">
                  <h2 className="text-base font-semibold text-slate-800">Manage Your Locations</h2>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-[520px]">
                    Create locations for each branch and warehouse in your organisation and manage
                    them all in one place.
                  </p>
                </div>

                {locationsEnabled ? (
                  <button
                    type="button"
                    onClick={openAdd}
                    className="flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-[var(--finos-accent)] hover:bg-blue-600 rounded-md transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Location
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowEnable(true)}
                    className="h-9 px-5 text-sm font-medium text-white bg-[var(--finos-accent)] hover:bg-blue-600 rounded-md transition-colors"
                  >
                    Enable Locations
                  </button>
                )}
              </div>

              {/* Illustration */}
              <div className="hidden md:block shrink-0 w-[160px] h-[130px]">
                <LocationIllustration />
              </div>
            </section>

            {/* ── Benefits + Notes ── */}
            <BenefitsCard />
            <PointsToNote />

            {/* ── Location tree section ── */}
            <section>
              <SectionTitle title="Location Hierarchy" />
              <div className={cn(
                "mt-3 rounded-xl border border-slate-200 overflow-x-auto",
                locationsEnabled ? "bg-[#eef3fb]" : "bg-[#eef3fb] relative"
              )}>
                {!locationsEnabled && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="text-center space-y-2">
                      <p className="text-sm font-medium text-slate-500">Enable Locations to manage your location tree.</p>
                      <button
                        type="button"
                        onClick={() => setShowEnable(true)}
                        className="text-sm text-[var(--finos-accent)] hover:underline font-medium"
                      >
                        Enable now
                      </button>
                    </div>
                  </div>
                )}
                <LocationTree
                  orgName={orgName}
                  locations={treeLocations}
                  onSelect={locationsEnabled ? setSelected : undefined}
                  muted={!locationsEnabled}
                />
              </div>
            </section>

            <div className="pb-10" />
          </div>
        </main>

        <RightUtilityDock />
      </div>

      <AssistanceButton />

      {/* Modals */}
      {showEnable && (
        <EnableModal
          onClose={() => setShowEnable(false)}
          onConfirm={handleEnable}
          loading={isPending}
        />
      )}

      {showForm && (
        <LocationFormModal
          mode={formMode}
          initial={formInitial}
          locations={locations}
          onClose={() => setShowForm(false)}
          onSave={handleSave}
          loading={isPending}
        />
      )}

      {selected && !showForm && (
        <LocationDetailModal
          location={selected}
          allLocations={locations}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onToggleStatus={handleToggleStatus}
          onDelete={handleDelete}
          loading={isPending}
        />
      )}
    </div>
  );
}
