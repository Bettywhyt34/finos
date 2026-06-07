import { redirect }       from "next/navigation";
import { auth }            from "@/lib/auth";
import { UsersRolesShell } from "./shell";

export default async function UsersRolesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  return (
    <UsersRolesShell orgName={session.user.tenantName ?? "Organisation"}>
      {children}
    </UsersRolesShell>
  );
}
