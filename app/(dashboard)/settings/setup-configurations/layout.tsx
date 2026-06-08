import { redirect }                  from "next/navigation";
import { auth }                       from "@/lib/auth";
import { SetupConfigurationsShell }   from "./shell";

export default async function SetupConfigurationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  return (
    <SetupConfigurationsShell orgName={session.user.tenantName ?? "Organisation"}>
      {children}
    </SetupConfigurationsShell>
  );
}
