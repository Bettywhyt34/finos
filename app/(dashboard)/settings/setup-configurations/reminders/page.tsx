import { redirect }            from "next/navigation";
import { auth }                from "@/lib/auth";
import { getReminderRules }    from "@/lib/setup-configurations/service";
import { RemindersClient }     from "./reminders-client";

export default async function RemindersPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const rules = await getReminderRules(session.user.tenantId!);

  return <RemindersClient initialRules={rules} />;
}
