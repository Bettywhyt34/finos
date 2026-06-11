import { redirect } from "next/navigation";
export default function EmailNotificationsRedirect() {
  redirect("/settings/customization/email-notifications");
}
