"use client";

import { usePathname }        from "next/navigation";
import { FullSettingsShell }  from "@/components/settings/settings-shell";

function getActiveItem(pathname: string): string {
  if (pathname.includes("/setup-configurations/currencies"))        return "setup-currencies";
  if (pathname.includes("/setup-configurations/payment-terms"))     return "setup-payment-terms";
  if (pathname.includes("/setup-configurations/opening-balances"))  return "setup-opening-balances";
  if (pathname.includes("/setup-configurations/reminders"))         return "setup-reminders";
  if (pathname.includes("/setup-configurations/customer-portal"))   return "setup-customer-portal";
  if (pathname.includes("/setup-configurations/vendor-portal"))     return "setup-vendor-portal";
  return "setup-general";
}

const BREADCRUMBS: Record<string, string> = {
  "setup-general":           "General",
  "setup-currencies":        "Currencies",
  "setup-payment-terms":     "Payment Terms",
  "setup-opening-balances":  "Opening Balances",
  "setup-reminders":         "Reminders",
  "setup-customer-portal":   "Customer Portal",
  "setup-vendor-portal":     "Vendor Portal",
};

interface Props {
  orgName:  string;
  children: React.ReactNode;
}

export function SetupConfigurationsShell({ orgName, children }: Props) {
  const pathname   = usePathname();
  const activeItem = getActiveItem(pathname ?? "");
  const breadcrumb = BREADCRUMBS[activeItem] ?? "Setup & Configurations";

  return (
    <FullSettingsShell orgName={orgName} activeItem={activeItem} breadcrumb={breadcrumb}>
      <div className="h-full overflow-y-auto">
        {children}
      </div>
    </FullSettingsShell>
  );
}
