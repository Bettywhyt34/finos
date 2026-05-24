import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SettingsHub } from "./settings-hub";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  return <SettingsHub orgName={session.user.tenantName ?? "Your Organisation"} />;
}
