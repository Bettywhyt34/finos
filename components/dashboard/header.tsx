"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

interface HeaderProps {
  orgName: string | null | undefined;
  currency: string;
  tenantId: string;
  entities: { id: string; name: string; currency: string }[];
}

export function Header({ orgName, currency, tenantId, entities }: HeaderProps) {
  const { update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [switching, setSwitching] = useState(false);
  async function switchEntity(id: string) {
    setSwitching(true);
    try {
      const session = await update({ tenantId: id });
      if (session?.user.tenantId !== id) throw new Error("Entity access is no longer available.");
      // Full navigation discards in-memory queries and unsaved forms from the old entity.
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch entity");
      setSwitching(false);
    }
  }
  return (
    <header className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 border-b bg-white px-6 py-4">
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Toggle navigation" className="rounded border px-3 py-2" onClick={() => document.querySelector("aside")?.classList.toggle("hidden")}>☰</button>
        <label className="text-sm">
          <span className="sr-only">Active company</span>
          <select aria-label="Active company" value={tenantId} disabled={switching} onChange={e => void switchEntity(e.target.value)} className="max-w-72 rounded border p-2 font-semibold">
            {entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} · {entity.currency}</option>)}
          </select>
          <span className="sr-only">{orgName} {currency}</span>
        </label>
      </div>
      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link href="/financial-brain">Financial Brain</Link>
        <Link href="/reports/consolidation">Consolidation</Link>
        {pathname !== "/" && <button onClick={() => router.push("/")}>Financial overview</button>}
        <Link href="/settings/organization">Entity settings</Link>
      </nav>
    </header>
  );
}
