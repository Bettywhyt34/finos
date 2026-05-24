import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrgForm from "./org-form";

export const metadata = { title: "Organisation Settings" };

export default async function OrganisationSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: {
      id: true,
      name: true,
      currency: true,
      countryCode: true,
      fiscalYearStart: true,
      timezone: true,
      industryCode: true,
    },
  });

  if (!tenant) redirect("/login");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Organisation Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your organisation profile and financial preferences.
        </p>
      </div>
      <OrgForm tenant={tenant} />
    </div>
  );
}
