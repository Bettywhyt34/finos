import { redirect } from "next/navigation";

export default function RemindersRedirectPage() {
  redirect("/settings/setup-configurations/reminders");
}
