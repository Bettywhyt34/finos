"use client";

import { usePathname }       from "next/navigation";
import Link                  from "next/link";
import { cn }                from "@/lib/utils";
import { FullSettingsShell } from "@/components/settings/settings-shell";

function getActiveItem(pathname: string): string {
  if (pathname.includes("/taxes/settings")) return "tax-settings";
  return "tax-rates";
}

const BREADCRUMBS: Record<string, string> = {
  "tax-rates":    "Tax Rates",
  "tax-settings": "Tax Settings",
};

const SECONDARY_NAV = [
  { id: "tax-rates",    label: "Tax Rates",    href: "/settings/taxes-compliance/taxes/rates"    },
  { id: "tax-settings", label: "Tax Settings", href: "/settings/taxes-compliance/taxes/settings" },
];

interface Props {
  orgName:  string;
  children: React.ReactNode;
}

export function TaxesComplianceShell({ orgName, children }: Props) {
  const pathname   = usePathname();
  const activeItem = getActiveItem(pathname ?? "");
  const breadcrumb = BREADCRUMBS[activeItem] ?? "Taxes & Compliance";

  return (
    <FullSettingsShell orgName={orgName} activeItem={activeItem} breadcrumb={breadcrumb}>
      {/* Secondary nav + scrollable content — no chrome duplication */}
      <div className="flex h-full overflow-hidden">
        <aside className="w-44 shrink-0 border-r border-slate-200 bg-white py-5 px-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
            Taxes
          </p>
          {SECONDARY_NAV.map((item) => {
            const isActive = activeItem === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "flex items-center px-2 py-2 rounded-md text-[13px] transition-colors no-underline",
                  isActive
                    ? "bg-[var(--finos-accent)]/10 text-[var(--finos-accent)] font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </aside>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </FullSettingsShell>
  );
}
