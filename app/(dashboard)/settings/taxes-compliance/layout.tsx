import { redirect }              from "next/navigation";
import { auth }                  from "@/lib/auth";
import { TaxesComplianceShell }  from "./shell";

export default async function TaxesComplianceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  return (
    <TaxesComplianceShell orgName={session.user.tenantName ?? "Organisation"}>
      {children}
    </TaxesComplianceShell>
  );
}
