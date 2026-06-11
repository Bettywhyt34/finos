import { redirect } from "next/navigation";
export default function EmailTemplatesRedirect() {
  redirect("/settings/customization/email-notifications");
}
