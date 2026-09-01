import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProjectStatusControl } from "./project-status-control";

export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const tenantId = session?.user?.tenantId;
  const canManage = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user?.role ?? "");

  if (!tenantId || !canManage) return children;

  const project = await prisma.project.findFirst({
    where: { id, tenantId },
    select: { status: true },
  });

  if (!project) return children;

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[1500px] flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] bg-white px-4 py-3">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Project controls</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Edits are prospective. Status changes are operational only and never reverse invoices, revenue, costs or journals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/projects/${id}/edit`}
            className="inline-flex h-9 items-center rounded-lg border border-[var(--app-border)] bg-white px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
          >
            Edit project
          </Link>
          <ProjectStatusControl projectId={id} currentStatus={String(project.status)} />
        </div>
      </div>
      {children}
    </>
  );
}
