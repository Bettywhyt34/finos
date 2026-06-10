import { redirect }             from "next/navigation";
import { auth }                from "@/lib/auth";
import { CustomizationShell } from "./shell";

export default async function CustomizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  return (
    <CustomizationShell orgName={session.user.tenantName ?? "Organisation"}>
      {children}
    </CustomizationShell>
  );
}
