"use client";

/**
 * Shared settings shell components.
 * Used by OrgProfile, Branding, and any future settings pages
 * that need the Zoho-style full-screen layout.
 *
 * FullSettingsShell — single source of truth for settings page chrome.
 * Section shells (users-roles, taxes-compliance, etc.) import this and
 * add only their module-specific layout (e.g. secondary nav).
 */

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2, Users, FileText, Sliders, Palette, Zap,
  ShoppingCart, Package, Code2, Plug, Landmark,
  Search, X, ChevronRight, ChevronDown,
  HelpCircle, Bell, MessageCircle, CalendarDays, Settings2, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Nav data ─────────────────────────────────────────────────────────────────

type NavChild   = { id: string; label: string; href: string };
type NavGroup   = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; children?: NavChild[]; href?: string };
type NavSection = { id: string; title: string; items: NavGroup[] };

export const SIDEBAR_NAV: NavSection[] = [
  {
    id: "org",
    title: "ORGANISATION SETTINGS",
    items: [
      {
        id: "organization", label: "Organization", icon: Building2,
        children: [
          { id: "profile",      label: "Profile",             href: "/settings/orgprofile"               },
          { id: "branding",     label: "Branding",            href: "/settings/organization/branding"    },
          { id: "domain",       label: "Custom Domain",       href: "/settings/organization/domain"      },
          { id: "locations",    label: "Locations",           href: "/settings/organization/locations"   },
          { id: "ai",           label: "AI Preferences",      href: "/settings/organization/ai"          },
          { id: "subscription", label: "Manage Subscription", href: "/settings/organization/subscription"},
        ],
      },
      {
        id: "users-roles", label: "Users & Roles", icon: Users,
        children: [
          { id: "users",            label: "Users",            href: "/settings/users-roles/users"            },
          { id: "roles",            label: "Roles",            href: "/settings/users-roles/roles"            },
          { id: "user-preferences", label: "User Preferences", href: "/settings/users-roles/user-preferences" },
        ],
      },
      {
        id: "taxes-compliance", label: "Taxes & Compliance", icon: FileText,
        children: [
          { id: "tax-rates",    label: "Tax Rates",    href: "/settings/taxes-compliance/taxes/rates"    },
          { id: "tax-settings", label: "Tax Settings", href: "/settings/taxes-compliance/taxes/settings" },
        ],
      },
      { id: "setup",         label: "Setup & Configurations", icon: Sliders,   href: "/settings/general"       },
      { id: "customization", label: "Customization",          icon: Palette,   href: "/settings/customization" },
      { id: "automation",    label: "Automation",             icon: Zap,       href: "/settings/automation"    },
    ],
  },
  {
    id: "modules",
    title: "MODULE SETTINGS",
    items: [
      { id: "general-mod",   label: "General",         icon: Package,      href: "/settings/modules/general"   },
      { id: "online-pay",    label: "Online Payments", icon: Landmark,     href: "/settings/modules/payments"  },
      { id: "sales-mod",     label: "Sales",           icon: ShoppingCart, href: "/settings/modules/sales"     },
      { id: "purchases-mod", label: "Purchases",       icon: Package,      href: "/settings/modules/purchases" },
      { id: "custom-mod",    label: "Custom Modules",  icon: Code2,        href: "/settings/modules/custom"    },
    ],
  },
  {
    id: "extensions",
    title: "EXTENSIONS",
    items: [
      { id: "integrations", label: "Integrations", icon: Plug,  href: "/settings/integrations" },
    ],
  },
];

export const ALL_NAV_ITEMS = SIDEBAR_NAV.flatMap((s) =>
  s.items.flatMap((g) =>
    g.children
      ? g.children.map((c) => ({ ...c, parent: g.label }))
      : [{ id: g.id, label: g.label, href: g.href ?? "#", parent: s.title }]
  )
);

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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

// ─── SectionTitle ─────────────────────────────────────────────────────────────

export function SectionTitle({ title }: { title: string }) {
  return (
    <div className="pt-1">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      <div className="h-px bg-slate-200 mt-2.5" />
    </div>
  );
}

// ─── SettingsHeader ───────────────────────────────────────────────────────────

export function SettingsHeader({
  orgName,
  breadcrumb,
  search,
  onSearch,
  onClose,
  searchRef,
}: {
  orgName: string;
  breadcrumb: string;
  search: string;
  onSearch: (v: string) => void;
  onClose: () => void;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <header className="shrink-0 h-14 bg-white border-b border-slate-200 flex items-center px-6 gap-6 z-10">
      {/* Left — FINOS wordmark + breadcrumb */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Link href="/" className="text-base font-bold text-slate-900 leading-none hover:text-slate-700 transition-colors">
          FINOS
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <Link href="/settings" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
          Settings
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-sm text-slate-700 font-medium">{breadcrumb}</span>
      </div>

      {/* Center search */}
      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search settings  (Ctrl + /)"
            className="w-full pl-9 pr-8 py-1.5 text-sm bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 focus:bg-white placeholder:text-slate-400 transition-colors"
          />
          {search && (
            <button onClick={() => onSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="hidden lg:inline-flex text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-md truncate max-w-[180px]">
          {orgName}
        </span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
        >
          Close
          <X className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
        </button>
      </div>
    </header>
  );
}

// ─── SettingsSidebar ──────────────────────────────────────────────────────────

export function SettingsSidebar({
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

  const renderLeaf = (id: string, label: string, href: string, parentLabel?: string) => {
    const isActive = activeItem === id;
    return (
      <Link
        key={id}
        href={href}
        className={cn(
          "flex items-center justify-between px-3 py-2 rounded-md text-sm no-underline transition-colors",
          isActive ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        )}
      >
        <span>{label}</span>
        {parentLabel && !isActive && (
          <span className="text-xs text-slate-400 truncate ml-2">{parentLabel}</span>
        )}
      </Link>
    );
  };

  if (q) {
    return (
      <aside className="shrink-0 w-[248px] bg-white border-r border-slate-200 overflow-y-auto">
        <div className="px-3 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide px-2 mb-2">Results</p>
          {searchResults.length > 0
            ? searchResults.map((i) => renderLeaf(i.id, i.label, i.href, i.parent))
            : <p className="text-sm text-slate-400 px-2 py-2">No results for &ldquo;{q}&rdquo;</p>
          }
        </div>
      </aside>
    );
  }

  return (
    <aside className="shrink-0 w-[248px] bg-white border-r border-slate-200 overflow-y-auto">
      <div className="py-3">
        {SIDEBAR_NAV.map((section) => (
          <div key={section.id} className="mb-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide px-4 py-1.5">
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
                        "w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors",
                        isGroupActive ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"
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
                        "flex items-center gap-2.5 px-4 py-2 text-sm no-underline transition-colors",
                        isGroupActive ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <group.icon className="h-4 w-4 shrink-0 text-slate-400" />
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
                            "flex items-center pl-5 pr-4 py-2 text-sm no-underline transition-colors",
                            activeItem === child.id
                              ? "bg-slate-100 text-slate-900 font-medium"
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

// ─── RightUtilityDock ─────────────────────────────────────────────────────────

export function RightUtilityDock() {
  const items = [
    { Icon: HelpCircle,    label: "Help"          },
    { Icon: Bell,          label: "Notifications" },
    { Icon: MessageCircle, label: "Chat"          },
    { Icon: CalendarDays,  label: "Calendar"      },
    { Icon: Settings2,     label: "Preferences"   },
  ];
  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 flex-col gap-1 pr-1 z-50 hidden xl:flex">
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

// ─── AssistanceButton ─────────────────────────────────────────────────────────

export function AssistanceButton() {
  return (
    <button
      type="button"
      className="fixed bottom-6 right-5 z-50 flex items-center gap-2 bg-[var(--finos-accent)] hover:opacity-90 text-white text-[13px] font-medium px-4 py-2.5 rounded-full shadow-lg transition-opacity"
    >
      <MessageSquare className="h-3.5 w-3.5" />
      Need Assistance?
    </button>
  );
}

// ─── FullSettingsShell ────────────────────────────────────────────────────────
// Single source of truth for the settings page chrome.
// Manages: search state, expanded sidebar groups, keyboard shortcuts,
//          close navigation. Section shells use this and add their own
//          module-specific layout inside the content slot.

function deriveDefaultExpanded(activeItem: string): Set<string> {
  for (const section of SIDEBAR_NAV) {
    for (const group of section.items) {
      if (group.children?.some((c) => c.id === activeItem)) {
        return new Set([group.id]);
      }
    }
  }
  return new Set();
}

export function FullSettingsShell({
  orgName,
  activeItem,
  breadcrumb,
  children,
}: {
  orgName:   string;
  activeItem: string;
  breadcrumb: string;
  children:  React.ReactNode;
}) {
  const router    = useRouter();
  const searchRef = useRef<HTMLInputElement>(null!);

  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => deriveDefaultExpanded(activeItem));

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f8fb] flex flex-col">
      <SettingsHeader
        orgName={orgName}
        breadcrumb={breadcrumb}
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
          activeItem={activeItem}
        />

        {/* Content slot — section shells control their own overflow */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>

        <RightUtilityDock />
      </div>

      <AssistanceButton />
    </div>
  );
}
