import { redirect }                           from "next/navigation";
import { auth }                              from "@/lib/auth";
import { getEmailNotificationTemplates }     from "@/lib/customization/email-notifications-service";
import { EmailNotificationsClient }          from "./email-notifications-client";

export default async function EmailNotificationsPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const category  = (searchParams.category ?? "SALES").toUpperCase();
  const templates = await getEmailNotificationTemplates(session.user.tenantId!, category);

  return (
    <EmailNotificationsClient
      key={category}
      initialTemplates={templates}
      initialCategory={category}
    />
  );
}
