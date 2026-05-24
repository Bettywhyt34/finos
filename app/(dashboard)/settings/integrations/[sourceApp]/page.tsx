import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChevronLeft } from "lucide-react";
import { MappingManager } from "./mapping-manager";

export default async function IntegrationMappingsPage({
  params,
}: {
  params: { sourceApp: string };
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) redirect("/auth/signin");

  const { sourceApp } = params;

  // Verify this integration exists in the registry
  const entry = await prisma.integrationRegistry.findUnique({
    where: { sourceApp },
  });
  if (!entry) redirect("/settings/integrations");

  const [mappings, coaOptions] = await Promise.all([
    prisma.accountMapping.findMany({
      where: { tenantId, sourceApp, isActive: true },
      include: { finosAccount: { select: { code: true, name: true } } },
      orderBy: { sourceAccountCode: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link
          href="/settings/integrations"
          className="flex items-center gap-1 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft size={14} />
          Integrations
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">{entry.displayName}</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {entry.displayName} — Account Mappings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Map {entry.displayName} account codes to your FINOS chart of accounts. These mappings
          are used when auto-posting GL entries during sync.
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-4">
        <div className="rounded-lg border bg-white px-4 py-3 text-sm">
          <span className="text-slate-500">Active mappings: </span>
          <span className="font-semibold text-slate-900">{mappings.length}</span>
        </div>
        <div className="rounded-lg border bg-white px-4 py-3 text-sm">
          <span className="text-slate-500">Category: </span>
          <span className="font-semibold text-slate-900 capitalize">{entry.category}</span>
        </div>
      </div>

      {/* Manager */}
      <MappingManager
        sourceApp={sourceApp}
        initialMappings={mappings}
        coaOptions={coaOptions}
      />
    </div>
  );
}
