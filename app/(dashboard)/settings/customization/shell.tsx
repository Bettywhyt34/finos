"use client";

import { usePathname }       from "next/navigation";
import { FullSettingsShell } from "@/components/settings/settings-shell";

function getActiveItem(pathname: string): string {
  if (pathname.includes("/customization/transaction-number-series")) {
    return "customization-transaction-numbers";
  }
  if (pathname.includes("/customization/pdf-templates")) {
    return "customization-pdf-templates";
  }
  if (pathname.includes("/customization/email-templates")) {
    return "customization-email-templates";
  }
  if (pathname.includes("/customization/reporting-tags")) {
    return "customization-reporting-tags";
  }
  return "customization-transaction-numbers";
}

const BREADCRUMBS: Record<string, string> = {
  "customization-transaction-numbers": "Transaction Number Series",
  "customization-pdf-templates":       "PDF Templates",
  "customization-email-templates":     "Email Templates",
  "customization-reporting-tags":      "Reporting Tags",
};

interface Props {
  orgName:  string;
  children: React.ReactNode;
}

export function CustomizationShell({ orgName, children }: Props) {
  const pathname   = usePathname();
  const activeItem = getActiveItem(pathname ?? "");
  const breadcrumb = BREADCRUMBS[activeItem] ?? "Customization";

  return (
    <FullSettingsShell orgName={orgName} activeItem={activeItem} breadcrumb={breadcrumb}>
      <div className="h-full overflow-y-auto">
        {children}
      </div>
    </FullSettingsShell>
  );
}
