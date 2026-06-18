import { redirect }        from "next/navigation";
import { auth }            from "@/lib/auth";
import { getWebTabs }      from "@/lib/customization/web-tabs-service";
import { WebTabsClient }   from "./web-tabs-client";

export default async function WebTabsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tabs = await getWebTabs(session.user.tenantId!);

  return <WebTabsClient initialTabs={tabs} />;
}
