"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Download, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  orgName: string | null | undefined;
  currency: string;
}

export function Header({ orgName, currency }: HeaderProps) {
  const router = useRouter();
  const now = new Date();
  const period = new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(now);

  return (
    <header className="flex h-[88px] shrink-0 items-center justify-between border-b border-[var(--topbar-border)] bg-[var(--topbar-bg)] px-8">
      <div className="flex items-center gap-5">
        <button type="button" aria-label="Collapse navigation" className="grid h-10 w-10 place-items-center rounded-lg text-[var(--topbar-text)] hover:bg-[var(--surface-muted)]">
          <Menu className="h-5 w-5" />
        </button>
        <div className="h-8 w-px bg-[var(--topbar-border)]" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex min-w-[220px] items-center gap-4 rounded-lg px-3 py-2 text-left hover:bg-[var(--surface-muted)] focus:outline-none">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--topbar-text)]">{orgName ?? "Your company"}</p>
              <p className="mt-0.5 text-xs text-[var(--topbar-org)]">Company · {currency}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-[var(--topbar-org)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 border-[var(--app-border)] bg-white p-2">
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Group overview</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Companies</DropdownMenuLabel>
            <DropdownMenuItem className="rounded-md bg-[var(--surface-muted)] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{orgName ?? "Your company"}</p>
                <p className="text-xs text-[var(--text-muted)]">Company · {currency}</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuLabel className="mt-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Investment / holding entities</DropdownMenuLabel>
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Personal workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/settings/organization")}
              className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-[var(--finos-accent)]"
            >
              Entity management
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-4">
        <p className="hidden text-xs text-[var(--text-muted)] xl:block">Last updated: Today</p>
        <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-[var(--app-border)] bg-white px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]">
          <CalendarDays className="h-4 w-4" />
          {period}
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
        </button>
        <button type="button" className="flex h-10 items-center gap-2 rounded-lg bg-[var(--finos-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)]">
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>
    </header>
  );
}
