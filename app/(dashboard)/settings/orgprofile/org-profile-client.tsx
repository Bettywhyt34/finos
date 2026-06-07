"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronRight, ChevronDown, X, Search,
  HelpCircle, Bell, MessageCircle, CalendarDays, Settings2, MessageSquare,
  Building2, Users, FileText, Sliders, Palette, Zap,
  ShoppingCart, Package, Code2, Plug, Landmark,
  Globe, DollarSign, Briefcase, User, Save, Lock,
  Trash2, Info, Plus, Pencil, ImageIcon, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";

// ─── Configurable text constants ──────────────────────────────────────────────
const APP_NAME          = "FINOS Books";
const SENDER_NAME       = "finance";
const SENDER_EMAIL      = "finance@yourcompany.com";
const EMAIL_SENDER_NAME = `Email address of ${APP_NAME}`;
const EMAIL_SENDER_ADDR = "message-service@sender.finosbooks.com";
const INTEGRATION_NOTICE =
  `This organisation is linked across ${APP_NAME} modules. Changes made here apply to all connected modules.`;

// ─── Static form data ─────────────────────────────────────────────────────────
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIMEZONES = [
  { v: "Africa/Lagos",     l: "(GMT+1:00) West Africa Time — Lagos"       },
  { v: "Africa/Accra",     l: "(GMT+0:00) Greenwich Mean Time — Accra"    },
  { v: "Africa/Nairobi",   l: "(GMT+3:00) East Africa Time — Nairobi"     },
  { v: "Africa/Johannesburg",l: "(GMT+2:00) South Africa Time — Joburg"   },
  { v: "Europe/London",    l: "(GMT+0:00) British Time — London"          },
  { v: "Europe/Paris",     l: "(GMT+1:00) Central European Time — Paris"  },
  { v: "America/New_York", l: "(GMT-5:00) Eastern Time — New York"        },
  { v: "America/Chicago",  l: "(GMT-6:00) Central Time — Chicago"         },
  { v: "America/Los_Angeles",l: "(GMT-8:00) Pacific Time — Los Angeles"   },
  { v: "Asia/Dubai",       l: "(GMT+4:00) Gulf Standard Time — Dubai"     },
  { v: "Asia/Singapore",   l: "(GMT+8:00) Singapore Time"                 },
];

const COUNTRIES = [
  { code: "NG", name: "Nigeria"              },
  { code: "GH", name: "Ghana"               },
  { code: "KE", name: "Kenya"               },
  { code: "ZA", name: "South Africa"        },
  { code: "GB", name: "United Kingdom"      },
  { code: "US", name: "United States"       },
  { code: "DE", name: "Germany"             },
  { code: "FR", name: "France"              },
  { code: "AE", name: "United Arab Emirates"},
  { code: "SG", name: "Singapore"           },
  { code: "CA", name: "Canada"              },
  { code: "AU", name: "Australia"           },
];

const INDUSTRIES = [
  { code: "retail",         name: "Retail"                   },
  { code: "wholesale",      name: "Wholesale / Distribution" },
  { code: "manufacturing",  name: "Manufacturing"            },
  { code: "services",       name: "Professional Services"    },
  { code: "hospitality",    name: "Hospitality & Food"       },
  { code: "tech",           name: "Technology"               },
  { code: "finance",        name: "Financial Services"       },
  { code: "healthcare",     name: "Healthcare"               },
  { code: "ngo",            name: "Non-Profit / NGO"         },
  { code: "advertising",    name: "Advertising & Marketing"  },
  { code: "consulting",     name: "Consulting"               },
  { code: "media",          name: "Media & Entertainment"    },
  { code: "other",          name: "Other"                    },
];

const DATE_FORMATS = [
  { v: "dd MMM yyyy", l: "dd MMM yyyy  [ 24 May 2026 ]" },
  { v: "MM/dd/yyyy",  l: "MM/dd/yyyy  [ 05/24/2026 ]"   },
  { v: "dd/MM/yyyy",  l: "dd/MM/yyyy  [ 24/05/2026 ]"   },
  { v: "yyyy-MM-dd",  l: "yyyy-MM-dd  [ 2026-05-24 ]"   },
];

// ─── Sidebar nav data ─────────────────────────────────────────────────────────
type NavChild   = { id: string; label: string; href: string };
type NavGroup   = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; children?: NavChild[]; href?: string };
type NavSection = { id: string; title: string; items: NavGroup[] };

const SIDEBAR_NAV: NavSection[] = [
  {
    id: "org",
    title: "ORGANISATION",
    items: [
      {
        id: "organization", label: "Organization", icon: Building2,
        children: [
          { id: "profile",       label: "Profile",             href: "/settings/orgprofile"              },
          { id: "branding",      label: "Branding",            href: "/settings/organization/branding"   },
          { id: "domain",        label: "Custom Domain",       href: "/settings/organization/domain"     },
          { id: "locations",     label: "Locations",           href: "/settings/organization/locations"  },
          { id: "ai",            label: "AI Preferences",      href: "/settings/organization/ai"         },
          { id: "subscription",  label: "Manage Subscription", href: "/settings/organization/subscription"},
        ],
      },
      { id: "users-roles",    label: "Users & Roles",         icon: Users,    href: "/settings/users-roles/users" },
      { id: "taxes",          label: "Taxes & Compliance",    icon: FileText, href: "/settings/taxes"         },
      { id: "setup",          label: "Setup & Configurations",icon: Sliders,  href: "/settings/general"       },
      { id: "customization",  label: "Customization",         icon: Palette,  href: "/settings/customization" },
      { id: "automation",     label: "Automation",            icon: Zap,      href: "/settings/automation"    },
    ],
  },
  {
    id: "modules",
    title: "MODULE SETTINGS",
    items: [
      { id: "general-mod",    label: "General",           icon: Package,     href: "/settings/modules/general"   },
      { id: "banking-mod",    label: "Banking",           icon: Landmark,    href: "/banking/accounts"            },
      { id: "sales-mod",      label: "Sales",             icon: ShoppingCart,href: "/settings/modules/sales"     },
      { id: "purchases-mod",  label: "Purchases",         icon: Package,     href: "/settings/modules/purchases"  },
      { id: "custom-mod",     label: "Custom Modules",    icon: Package,     href: "/settings/modules/custom"     },
    ],
  },
  {
    id: "extensions",
    title: "EXTENSIONS & DEVELOPER",
    items: [
      { id: "integrations",   label: "Integrations & Marketplace", icon: Plug,  href: "/settings/integrations" },
      { id: "developer",      label: "Developer Data",             icon: Code2, href: "/settings/developer"    },
    ],
  },
];

// Flat list for search
const ALL_NAV_ITEMS = SIDEBAR_NAV.flatMap((s) =>
  s.items.flatMap((g) =>
    g.children
      ? g.children.map((c) => ({ ...c, parent: g.label }))
      : [{ id: g.id, label: g.label, href: g.href ?? "#", parent: s.title }]
  )
);

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TenantData {
  id: string;
  name: string;
  currency: string;
  countryCode: string;
  fiscalYearStart: number;
  timezone: string;
  industryCode: string | null;
  logoUrl?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  fax?: string | null;
  website?: string | null;
  companyId?: string | null;
  taxId?: string | null;
  additionalFields?: { label: string; value: string }[] | null;
}

interface Props {
  tenant: TenantData;
  orgName: string;
  logoUrl?: string | null;
  additionalFields?: { label: string; value: string }[];
}

interface FormState {
  name: string;
  currency: string;
  countryCode: string;
  fiscalYearStart: number;
  timezone: string;
  industryCode: string;
  // Address
  address1: string;
  address2: string;
  city: string;
  zip: string;
  state: string;
  phone: string;
  fax: string;
  website: string;
  paymentStub: boolean;
  // Localization
  reportBasis: "accrual" | "cash";
  language: string;
  dateFormat: string;
  companyIdLabel: string;
  companyId: string;
  taxIdLabel: string;
  taxId: string;
  additionalFields: { label: string; value: string }[];
}

// ─── Inline Toggle ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)] focus:ring-offset-1",
        checked ? "bg-[var(--finos-accent)]" : "bg-slate-200"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

// ─── FormRow ──────────────────────────────────────────────────────────────────
function FormRow({
  label,
  required,
  children,
  error,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex items-start gap-6 py-[14px] border-b border-slate-50 last:border-0">
      <div className="w-[196px] shrink-0 pt-[9px]">
        <span className="text-[13px] text-slate-600">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      <div className="flex-1 max-w-[420px]">
        {children}
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    </div>
  );
}

// ─── InfoBanner ───────────────────────────────────────────────────────────────
function InfoBanner({ text, linkLabel, linkHref }: { text: string; linkLabel?: string; linkHref?: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-[13px] text-blue-800">
      <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
      <span>
        {text}{" "}
        {linkLabel && linkHref && (
          <Link href={linkHref} className="text-[var(--finos-accent)] hover:underline font-medium">
            {linkLabel}
          </Link>
        )}
      </span>
    </div>
  );
}


// ─── Logo Uploader ────────────────────────────────────────────────────────────
function LogoUploader({ initialUrl }: { initialUrl?: string | null }) {
  const [preview, setPreview] = useState<string | null>(initialUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setErr("Please select an image file."); return; }
    if (file.size > 1024 * 1024) { setErr("Maximum file size is 1 MB."); return; }
    setErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/organization/logo", { method: "POST", body: fd });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? "Upload failed"); }
      const { url } = await res.json();
      setPreview(url);
      toast.success("Logo uploaded successfully.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setUploading(true);
    try {
      await fetch("/api/settings/organization/logo", { method: "DELETE" });
      setPreview(null);
      setErr("");
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Logo removed.");
    } catch {
      toast.error("Failed to remove logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-start gap-8">
      <div className="shrink-0">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="relative w-[260px] h-[110px] border border-[#d8dde6] rounded-lg bg-white flex items-center justify-center hover:bg-slate-50 transition-colors overflow-hidden disabled:opacity-60"
        >
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={preview} alt="Logo preview" className="max-h-[80px] max-w-[220px] object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-slate-300">
              <ImageIcon className="h-8 w-8" />
              <span className="text-[11px] text-slate-400">{uploading ? "Uploading…" : "Click to upload"}</span>
            </div>
          )}
          {/* Bottom strip */}
          <div className="absolute bottom-0 left-0 right-0 h-7 border-t border-[#d8dde6] bg-slate-50 flex items-center justify-center gap-2">
            <span className="text-[11px] text-slate-400">{uploading ? "Uploading…" : "Upload Logo"}</span>
          </div>
          {preview && !uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute bottom-1.5 right-2 p-0.5 text-red-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </button>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
      </div>
      <div className="text-[13px] text-slate-500 space-y-1 pt-1">
        <p>The logo will be displayed in transaction PDFs and email notifications.</p>
        <div className="mt-3 space-y-1 text-[12px] text-slate-400">
          <p>Preferred dimensions: 240 × 240 px @ 72 DPI</p>
          <p>Supported files: jpg, jpeg, png, gif, bmp</p>
          <p>Maximum file size: 1 MB</p>
        </div>
      </div>
    </div>
  );
}

// ─── Primary Contact Card ─────────────────────────────────────────────────────
function PrimaryContactCard() {
  return (
    <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-[#e5e7eb]">
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Sender</p>
          <p className="text-[13px] font-medium text-slate-800">{SENDER_NAME}</p>
          <p className="text-[13px] text-slate-500">{SENDER_EMAIL}</p>
        </div>
        <div className="px-5 py-4 relative">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Emails Are Sent Through</p>
          <p className="text-[13px] font-medium text-slate-800">{EMAIL_SENDER_NAME}</p>
          <p className="text-[13px] text-slate-500">{EMAIL_SENDER_ADDR}</p>
          <button type="button" className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-600">
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Additional Fields Table ──────────────────────────────────────────────────
function AdditionalFieldsTable({
  fields,
  onChange,
}: {
  fields: { label: string; value: string }[];
  onChange: (fields: { label: string; value: string }[]) => void;
}) {

  return (
    <div className="space-y-2">
      <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 border-b border-[#e5e7eb]">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Label Name</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Value</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="border-b border-[#e5e7eb] last:border-0">
                <td className="px-4 py-2">
                  <input
                    value={f.label}
                    onChange={(e) => {
                      const next = [...fields];
                      next[i] = { ...next[i], label: e.target.value };
                      onChange(next);
                    }}
                    placeholder="Label"
                    className="w-full h-8 px-2 border border-[#e5e7eb] rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] focus:border-[var(--finos-accent)]"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={f.value}
                    onChange={(e) => {
                      const next = [...fields];
                      next[i] = { ...next[i], value: e.target.value };
                      onChange(next);
                    }}
                    placeholder="Value"
                    className="w-full h-8 px-2 border border-[#e5e7eb] rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] focus:border-[var(--finos-accent)]"
                  />
                </td>
                <td className="px-2 py-2 w-8">
                  <button
                    type="button"
                    onClick={() => onChange(fields.filter((_, j) => j !== i))}
                    className="p-1 text-slate-300 hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...fields, { label: "", value: "" }])}
        className="flex items-center gap-1.5 text-[13px] text-[var(--finos-accent)] hover:text-blue-700 font-medium"
      >
        <Plus className="h-4 w-4" />
        New Field
      </button>
    </div>
  );
}

// ─── Settings Header ──────────────────────────────────────────────────────────
function SettingsHeader({
  orgName,
  search,
  onSearch,
  onClose,
  searchRef,
}: {
  orgName: string;
  search: string;
  onSearch: (v: string) => void;
  onClose: () => void;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <header className="shrink-0 h-[72px] bg-white border-b border-[#e5e7eb] flex items-center px-6 gap-6 z-10">
      {/* Left: logo + breadcrumb */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
          <span className="text-white text-xs font-black tracking-tight">F</span>
        </div>
        <Link href="/settings" className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors" title="All Settings">
          <Settings className="h-4 w-4 text-slate-600" />
        </Link>
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link href="/settings" className="text-slate-400 hover:text-slate-600 transition-colors">All Settings</Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          <span className="text-slate-600 font-medium">Organisation Profile</span>
        </div>
      </div>

      {/* Center: search */}
      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-[420px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search settings  (Ctrl + /)"
            className="w-full pl-9 pr-8 py-[7px] text-[13px] bg-slate-50 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 focus:bg-white placeholder:text-slate-400 transition-colors"
          />
          {search && (
            <button onClick={() => onSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right: org chip + close */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="hidden lg:inline-flex text-[12px] text-slate-500 bg-slate-50 border border-[#e5e7eb] px-3 py-1.5 rounded-lg truncate max-w-[180px]">
          {orgName}
        </span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-slate-600 bg-slate-50 border border-[#e5e7eb] rounded-lg hover:bg-slate-100 transition-colors"
        >
          Close Settings
          <X className="h-3.5 w-3.5 text-red-500 ml-0.5" />
        </button>
      </div>
    </header>
  );
}

// ─── Settings Sidebar ─────────────────────────────────────────────────────────
function SettingsSidebar({
  search,
  expanded,
  onToggle,
  activeItem,
}: {
  search: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeItem: string;
}) {
  const q = search.toLowerCase().trim();
  const searchResults = q ? ALL_NAV_ITEMS.filter((i) => i.label.toLowerCase().includes(q)) : [];

  const renderItem = (id: string, label: string, href: string, parentLabel?: string) => {
    const isActive = activeItem === id;
    return (
      <Link
        key={id}
        href={href}
        className={cn(
          "flex items-center justify-between px-3 py-[7px] rounded-md text-[13px] no-underline transition-colors",
          isActive
            ? "bg-[var(--finos-accent)] text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )}
      >
        <span>{label}</span>
        {parentLabel && !isActive && (
          <span className="text-[11px] text-slate-400 truncate ml-2">{parentLabel}</span>
        )}
      </Link>
    );
  };

  if (q) {
    return (
      <aside className="shrink-0 w-[250px] bg-white border-r border-[#e5e7eb] overflow-y-auto">
        <div className="px-3 py-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-2 mb-2">Results</p>
          {searchResults.length > 0
            ? searchResults.map((i) => renderItem(i.id, i.label, i.href, i.parent))
            : <p className="text-[13px] text-slate-400 px-2 py-2">No results for &ldquo;{q}&rdquo;</p>
          }
        </div>
      </aside>
    );
  }

  return (
    <aside className="shrink-0 w-[250px] bg-white border-r border-[#e5e7eb] overflow-y-auto">
      <div className="py-3">
        {SIDEBAR_NAV.map((section) => (
          <div key={section.id} className="mb-4">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-4 py-1.5">
              {section.title}
            </p>
            {section.items.map((group) => {
              const isExpanded = expanded.has(group.id);
              const hasChildren = !!group.children;
              const isGroupActive = hasChildren
                ? group.children!.some((c) => c.id === activeItem)
                : group.id === activeItem;

              return (
                <div key={group.id}>
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => onToggle(group.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-4 py-[9px] text-[13px] text-left transition-colors",
                        isGroupActive ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <group.icon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="flex-1">{group.label}</span>
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                      }
                    </button>
                  ) : (
                    <Link
                      href={group.href!}
                      className={cn(
                        "flex items-center gap-2.5 px-4 py-[9px] text-[13px] no-underline transition-colors",
                        isGroupActive
                          ? "bg-[var(--finos-accent)] text-white"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <group.icon className={cn("h-4 w-4 shrink-0", isGroupActive ? "text-white" : "text-slate-400")} />
                      <span>{group.label}</span>
                    </Link>
                  )}

                  {hasChildren && isExpanded && (
                    <div className="ml-4 border-l border-slate-100 my-0.5">
                      {group.children!.map((child) => (
                        <Link
                          key={child.id}
                          href={child.href}
                          className={cn(
                            "flex items-center pl-5 pr-4 py-[7px] text-[13px] no-underline transition-colors",
                            activeItem === child.id
                              ? "bg-[var(--finos-accent)] text-white font-medium"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          )}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Bottom Action Bar ────────────────────────────────────────────────────────
function BottomActionBar({
  onSave,
  onCancel,
  saving,
  isDirty,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isDirty: boolean;
}) {
  return (
    <footer className="shrink-0 h-14 bg-white border-t border-[#e5e7eb] flex items-center px-6 gap-3 z-10">
      <Button onClick={onSave} disabled={saving} className="h-8 px-5 gap-1.5 text-[13px]">
        <Save className="h-3.5 w-3.5" />
        {saving ? "Saving…" : "Save"}
      </Button>
      <button
        type="button"
        onClick={onCancel}
        className="h-8 px-5 text-[13px] font-medium text-slate-600 bg-white border border-[#e5e7eb] rounded-md hover:bg-slate-50 transition-colors"
      >
        Cancel
      </button>
      {isDirty && (
        <span className="text-[12px] text-amber-600 flex items-center gap-1.5 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          Unsaved changes
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-400">
        <Lock className="h-3 w-3" />
        Privacy Policy
      </div>
    </footer>
  );
}

// ─── Right Utility Dock ───────────────────────────────────────────────────────
function RightUtilityDock() {
  const items = [
    { Icon: HelpCircle,    label: "Help"          },
    { Icon: Bell,          label: "Notifications" },
    { Icon: MessageCircle, label: "Chat"          },
    { Icon: CalendarDays,  label: "Calendar"      },
    { Icon: Settings2,     label: "Preferences"   },
  ];
  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 flex flex-col gap-1 pr-1 z-50 hidden xl:flex">
      {items.map(({ Icon, label }) => (
        <button
          key={label}
          title={label}
          type="button"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm transition-all"
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

// ─── Assistance Button ────────────────────────────────────────────────────────
function AssistanceButton() {
  return (
    <button
      type="button"
      className="fixed bottom-16 right-5 z-50 flex items-center gap-2 bg-[var(--finos-accent)] hover:bg-blue-600 text-white text-[13px] font-medium px-4 py-2.5 rounded-full shadow-lg transition-colors"
    >
      <MessageSquare className="h-3.5 w-3.5" />
      Need Assistance?
    </button>
  );
}

// ─── Section Divider ──────────────────────────────────────────────────────────
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      <div className="h-px bg-[#e5e7eb] mt-2" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function OrgProfileClient({ tenant, orgName, logoUrl, additionalFields: initialAdditionalFields = [] }: Props) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["organization"]));

  const initial: FormState = useMemo(() => ({
    name:            tenant.name,
    currency:        tenant.currency,
    countryCode:     tenant.countryCode,
    fiscalYearStart: tenant.fiscalYearStart,
    timezone:        tenant.timezone,
    industryCode:    tenant.industryCode ?? "",
    address1: tenant.address1 ?? "",
    address2: tenant.address2 ?? "",
    city:     tenant.city     ?? "",
    zip:      tenant.zip      ?? "",
    state:    tenant.state    ?? "",
    phone:    tenant.phone    ?? "",
    fax:      tenant.fax      ?? "",
    website:  tenant.website  ?? "",
    paymentStub: false,
    reportBasis: "accrual",
    language: "english",
    dateFormat: "dd MMM yyyy",
    companyIdLabel: "Company ID",
    companyId: tenant.companyId ?? "",
    taxIdLabel: "Tax ID",
    taxId:     tenant.taxId    ?? "",
    additionalFields: initialAdditionalFields,
  }), [tenant]);

  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && search) setSearch("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  function validate() {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim())       errs.name        = "Organisation name is required";
    if (!form.industryCode)      errs.industryCode = "Industry is required";
    if (!form.countryCode)       errs.countryCode  = "Country is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) { toast.error("Please fill in all required fields."); return; }
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
          address1:        form.address1 || undefined,
          address2:        form.address2 || undefined,
          city:            form.city     || undefined,
          state:           form.state    || undefined,
          zip:             form.zip      || undefined,
          phone:           form.phone    || undefined,
          fax:             form.fax      || undefined,
          website:         form.website  || undefined,
          companyId:        form.companyId || undefined,
          taxId:            form.taxId    || undefined,
          additionalFields: form.additionalFields.filter(f => f.label.trim()),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      toast.success("Organisation profile saved.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error saving profile.");
    } finally {
      setSaving(false);
    }
  }

  const inp = "h-9 text-[13px] border-[#e5e7eb] focus-visible:ring-[var(--finos-accent)]/30 focus-visible:border-[var(--finos-accent)]";
  const sel = "h-9 text-[13px] border-[#e5e7eb]";
  const fiscalMonthName = MONTHS[(form.fiscalYearStart ?? 1) - 1] ?? "January";

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f8fb] flex flex-col">

      {/* ── Fixed header ── */}
      <SettingsHeader
        orgName={orgName}
        search={search}
        onSearch={setSearch}
        onClose={() => router.push("/settings")}
        searchRef={searchRef}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <SettingsSidebar
          search={search}
          expanded={expanded}
          onToggle={toggleExpanded}
          activeItem="profile"
        />

        {/* ── Main scrollable content ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-10 py-7 max-w-[860px] space-y-8">

            {/* Page title + ID chip */}
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <h1 className="text-[20px] font-semibold text-slate-900 tracking-tight">
                  Organisation Profile
                </h1>
                <span className="text-[12px] font-medium text-slate-500 bg-slate-100 border border-[#e5e7eb] px-2.5 py-0.5 rounded-full">
                  ID: {tenant.id.slice(0, 8).toUpperCase()}
                </span>
              </div>
              <div className="h-px bg-[#e5e7eb] mt-3" />
            </div>

            {/* Integration notice */}
            <InfoBanner text={INTEGRATION_NOTICE} />

            {/* ── Organisation Logo ── */}
            <section>
              <h2 className="text-[14px] font-semibold text-slate-700 mb-3">Organisation Logo</h2>
              <LogoUploader initialUrl={logoUrl} />
            </section>

            <div className="h-px bg-[#e5e7eb]" />

            {/* ── Core Details ── */}
            <section className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <p className="text-[13px] font-semibold text-slate-700">Organisation Details</p>
              </div>
              <div className="px-6 divide-y divide-slate-50">

                <FormRow label="Organisation Name" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    className={cn(inp, errors.name && "border-red-400")}
                    placeholder="e.g. Acme Ltd"
                  />
                </FormRow>

                <FormRow label="Industry" required error={errors.industryCode}>
                  <Select value={form.industryCode} onValueChange={(v) => set("industryCode", v ?? "")}>
                    <SelectTrigger className={cn(sel, errors.industryCode && "border-red-400")}>
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map(({ code, name }) => (
                        <SelectItem key={code} value={code}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>

                <FormRow label="Organisation Location" required error={errors.countryCode}>
                  <Select value={form.countryCode} onValueChange={(v) => set("countryCode", v ?? "NG")}>
                    <SelectTrigger className={cn(sel, errors.countryCode && "border-red-400")}>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(({ code, name }) => (
                        <SelectItem key={code} value={code}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>

                <FormRow label="Address Line 1">
                  <div className="relative">
                    <Input
                      value={form.address1}
                      onChange={(e) => set("address1", e.target.value)}
                      placeholder="Street address"
                      className={cn(inp, "pr-8")}
                    />
                    <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300" />
                  </div>
                </FormRow>

                <FormRow label="Address Line 2">
                  <Input
                    value={form.address2}
                    onChange={(e) => set("address2", e.target.value)}
                    placeholder="Street 2"
                    className={inp}
                  />
                </FormRow>

                <FormRow label="City / ZIP">
                  <div className="flex gap-2">
                    <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="City" className={cn(inp, "flex-1")} />
                    <Input value={form.zip}  onChange={(e) => set("zip",  e.target.value)} placeholder="ZIP / Postal Code" className={cn(inp, "flex-1")} />
                  </div>
                </FormRow>

                <FormRow label="State / Phone">
                  <div className="flex gap-2">
                    <Input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="State" className={cn(inp, "flex-1")} />
                    <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" className={cn(inp, "flex-1")} />
                  </div>
                </FormRow>

                <FormRow label="Fax Number">
                  <Input value={form.fax} onChange={(e) => set("fax", e.target.value)} placeholder="Fax Number" className={inp} />
                </FormRow>

                <FormRow label="">
                  <button type="button" className="text-[13px] text-[var(--finos-accent)] hover:underline">
                    Organisation Address Format ›
                  </button>
                </FormRow>

                <FormRow label="Website URL">
                  <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" className={inp} />
                </FormRow>

                {/* Payment stub toggle */}
                <FormRow label="">
                  <div className="border border-[#e5e7eb] rounded-lg px-4 py-3 flex items-center justify-between bg-slate-50/60">
                    <p className="text-[13px] text-slate-600">
                      Should payment receipts and remittance documents show a different address?
                    </p>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <span className="text-[13px] text-slate-500">{form.paymentStub ? "Yes" : "No"}</span>
                      <Toggle checked={form.paymentStub} onChange={(v) => set("paymentStub", v)} />
                    </div>
                  </div>
                  {form.paymentStub && (
                    <div className="mt-3 space-y-2 border-l-2 border-[var(--finos-accent)] pl-4">
                      <Input placeholder="Payment stub address line 1" className={inp} />
                      <Input placeholder="Payment stub address line 2" className={inp} />
                      <div className="flex gap-2">
                        <Input placeholder="City" className={cn(inp, "flex-1")} />
                        <Input placeholder="ZIP" className={cn(inp, "flex-1")} />
                      </div>
                    </div>
                  )}
                </FormRow>

              </div>
            </section>

            {/* ── Primary Contact ── */}
            <section className="space-y-3">
              <SectionTitle title="Primary Contact" />
              <PrimaryContactCard />
            </section>

            {/* ── Financial & Localisation ── */}
            <section className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <p className="text-[13px] font-semibold text-slate-700">Financial & Localisation</p>
              </div>
              <div className="px-6 divide-y divide-slate-50">

                {/* Base Currency */}
                <FormRow label="Base Currency">
                  <div className="flex items-center gap-2">
                    <Select value={form.currency} onValueChange={(v) => set("currency", v ?? "NGN")}>
                      <SelectTrigger className={cn(sel, "flex-1")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button type="button" className="p-1.5 text-slate-400 hover:text-slate-600">
                      <Settings2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-[12px] text-slate-400 mt-1.5">
                    You can&apos;t change the base currency as there are{" "}
                    <Link href="#" className="text-[var(--finos-accent)] hover:underline">transactions</Link>{" "}
                    recorded in your organisation.
                  </p>
                </FormRow>

                {/* Fiscal Year */}
                <FormRow label="Fiscal Year">
                  <Select value={String(form.fiscalYearStart)} onValueChange={(v) => set("fiscalYearStart", Number(v ?? "1"))}>
                    <SelectTrigger className={sel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {m} – {MONTHS[(i + 11) % 12]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-2 h-8 px-3 flex items-center border border-[#e5e7eb] rounded-md bg-slate-50 text-[13px] text-slate-500">
                    Period: 1 {fiscalMonthName} – {form.fiscalYearStart === 1 ? "31 December" : `${MONTHS[(form.fiscalYearStart) % 12]} ${form.fiscalYearStart - 1 === 0 ? 31 : 30}`}
                  </div>
                </FormRow>

                {/* Report Basis */}
                <FormRow label="Report Basis">
                  <div className="space-y-2.5">
                    {(["accrual", "cash"] as const).map((b) => (
                      <label key={b} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="radio"
                          name="reportBasis"
                          value={b}
                          checked={form.reportBasis === b}
                          onChange={() => set("reportBasis", b)}
                          className="h-4 w-4 accent-[var(--finos-accent)]"
                        />
                        <span className="text-[13px] text-slate-700">
                          {b === "accrual"
                            ? <><strong>Accrual</strong> · You owe tax as of invoice date</>
                            : <><strong>Cash</strong> · You owe tax upon payment receipt</>}
                        </span>
                      </label>
                    ))}
                  </div>
                </FormRow>

                {/* Language */}
                <FormRow label="Organisation Language">
                  <Select value={form.language} onValueChange={(v) => set("language", v ?? "english")}>
                    <SelectTrigger className={sel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="english">English</SelectItem>
                      <SelectItem value="french">French</SelectItem>
                      <SelectItem value="arabic">Arabic</SelectItem>
                    </SelectContent>
                  </Select>
                </FormRow>

                {/* Timezone */}
                <FormRow label="Time Zone">
                  <Select value={form.timezone} onValueChange={(v) => set("timezone", v ?? "Africa/Lagos")}>
                    <SelectTrigger className={sel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map(({ v, l }) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>

                {/* Date Format */}
                <FormRow label="Date Format">
                  <Select value={form.dateFormat} onValueChange={(v) => set("dateFormat", v ?? "dd MMM yyyy")}>
                    <SelectTrigger className={sel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map(({ v, l }) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>

                {/* Company ID */}
                <FormRow label="Company ID">
                  <div className="flex gap-2">
                    <Select value={form.companyIdLabel} onValueChange={(v) => set("companyIdLabel", v ?? "Company ID")}>
                      <SelectTrigger className={cn(sel, "w-[140px]")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Company ID">Company ID</SelectItem>
                        <SelectItem value="Business ID">Business ID</SelectItem>
                        <SelectItem value="Registration No">Registration No</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={form.companyId}
                      onChange={(e) => set("companyId", e.target.value)}
                      className={cn(inp, "flex-1")}
                      placeholder="Enter value"
                    />
                  </div>
                </FormRow>

                {/* Tax ID */}
                <FormRow label="Tax ID">
                  <div className="flex gap-2">
                    <Select value={form.taxIdLabel} onValueChange={(v) => set("taxIdLabel", v ?? "Tax ID")}>
                      <SelectTrigger className={cn(sel, "w-[140px]")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Tax ID">Tax ID</SelectItem>
                        <SelectItem value="VAT Number">VAT Number</SelectItem>
                        <SelectItem value="TIN">TIN</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={form.taxId}
                      onChange={(e) => set("taxId", e.target.value)}
                      className={cn(inp, "flex-1")}
                      placeholder="e.g. 03187020-0001"
                    />
                  </div>
                </FormRow>

              </div>
            </section>

            {/* ── Additional Fields ── */}
            <section className="space-y-3">
              <SectionTitle title="Additional Fields" />
              <AdditionalFieldsTable
                fields={form.additionalFields}
                onChange={(v) => set("additionalFields", v)}
              />
            </section>

            {/* Bottom spacer so last section clears the action bar */}
            <div className="h-6" />
          </div>
        </main>
      </div>

      {/* ── Fixed bottom bar ── */}
      <BottomActionBar
        onSave={handleSave}
        onCancel={() => setForm(initial)}
        saving={saving}
        isDirty={isDirty}
      />

      {/* ── Fixed overlays ── */}
      <RightUtilityDock />
      <AssistanceButton />
    </div>
  );
}
