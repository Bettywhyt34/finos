"use client";

import Link from "next/link";
import {
  Building2,
  Users,
  FileText,
  Sliders,
  Palette,
  Target,
  Plug,
  Landmark,
  BookOpen,
} from "lucide-react";

type IconType = React.ComponentType<{ className?: string }>;
type SettingItem = { label: string; href: string };
type SettingCard = {
  title: string;
  Icon: IconType;
  items: SettingItem[];
};
type SettingSection = {
  title: string;
  cards: SettingCard[];
};

const SETTINGS: SettingSection[] = [
  {
    title: "Organisation & access",
    cards: [
      {
        title: "Organisation",
        Icon: Building2,
        items: [
          { label: "Profile", href: "/settings/orgprofile" },
          { label: "Financial preferences", href: "/settings/organization" },
          { label: "Branding", href: "/settings/organization/branding" },
          { label: "Locations", href: "/settings/organization/locations" },
          { label: "Subscription", href: "/settings/organization/subscription" },
        ],
      },
      {
        title: "Users & roles",
        Icon: Users,
        items: [
          { label: "Users", href: "/settings/users-roles/users" },
          { label: "Roles", href: "/settings/users-roles/roles" },
          { label: "User preferences", href: "/settings/users-roles/user-preferences" },
        ],
      },
      {
        title: "Taxes & compliance",
        Icon: FileText,
        items: [
          { label: "Tax rates", href: "/settings/taxes-compliance/taxes/rates" },
          { label: "Tax settings", href: "/settings/taxes-compliance/taxes/settings" },
        ],
      },
    ],
  },
  {
    title: "Finance setup",
    cards: [
      {
        title: "Setup & configuration",
        Icon: Sliders,
        items: [
          { label: "General", href: "/settings/setup-configurations/general" },
          { label: "Currencies", href: "/settings/setup-configurations/currencies" },
          { label: "Payment terms", href: "/settings/setup-configurations/payment-terms" },
          { label: "Opening balances", href: "/settings/setup-configurations/opening-balances" },
          { label: "Reminders", href: "/settings/setup-configurations/reminders" },
          { label: "Customer portal", href: "/settings/setup-configurations/customer-portal" },
          { label: "Vendor portal", href: "/settings/setup-configurations/vendor-portal" },
        ],
      },
      {
        title: "Accounting",
        Icon: BookOpen,
        items: [
          { label: "Chart of accounts", href: "/accounting/chart-of-accounts" },
          { label: "System accounts", href: "/settings/accounting/system-accounts" },
          { label: "Journal entries", href: "/accounting/journal-entries" },
          { label: "Trial balance", href: "/accounting/trial-balance" },
          { label: "Period close", href: "/accounting/period-close" },
          { label: "FX revaluation", href: "/accounting/fx-revaluation" },
          { label: "Projects", href: "/projects" },
        ],
      },
      {
        title: "Banking",
        Icon: Landmark,
        items: [
          { label: "Bank accounts", href: "/banking/accounts" },
          { label: "Reconciliation", href: "/banking/reconciliation" },
        ],
      },
      {
        title: "Budgets",
        Icon: Target,
        items: [
          { label: "Budget settings", href: "/settings/budgets" },
          { label: "Budgets", href: "/budgets" },
          { label: "Create budget", href: "/budgets/new" },
        ],
      },
    ],
  },
  {
    title: "Customisation & integrations",
    cards: [
      {
        title: "Customisation",
        Icon: Palette,
        items: [
          { label: "Transaction numbers", href: "/settings/customization/transaction-number-series" },
          { label: "PDF templates", href: "/settings/customization/pdf-templates" },
          { label: "Email notifications", href: "/settings/customization/email-notifications" },
          { label: "Reporting tags", href: "/settings/customization/reporting-tags" },
          { label: "Web tabs", href: "/settings/customization/web-tabs" },
        ],
      },
      {
        title: "Connected apps",
        Icon: Plug,
        items: [
          { label: "Integration settings", href: "/settings/integrations" },
          { label: "Revflow", href: "/integrations/revflow/status" },
          { label: "XpenxFlow", href: "/integrations/xpenxflow/status" },
          { label: "EARNMARK360", href: "/integrations/earnmark360/status" },
        ],
      },
    ],
  },
];

export function SettingsHub({ orgName }: { orgName: string }) {
  return (
    <div className="mx-auto max-w-[1500px] space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--finos-accent)]">
          {orgName}
        </p>
        <h1 className="mt-2 text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          Configure the finance controls and capabilities that are currently available in FINOS.
        </p>
      </header>

      {SETTINGS.map((section) => (
        <section key={section.title} className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.cards.map((card) => (
              <div key={card.title} className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
                <div className="flex items-center gap-3 border-b border-[var(--app-border)] px-5 py-4">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#E9F4F0] text-[var(--finos-accent)]">
                    <card.Icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-semibold text-[var(--text-primary)]">{card.title}</h3>
                </div>
                <div className="divide-y divide-[var(--app-border)]">
                  {card.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block px-5 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
