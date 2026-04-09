import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!session.user?.organizationId) redirect("/register");

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar orgName={session.user.organizationName ?? "Your workspace"} />

      <div className="flex flex-col flex-1 min-w-0">
        <Header
          userName={session.user.name}
          userImage={session.user.image}
          orgName={session.user.organizationName}
        />
        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
