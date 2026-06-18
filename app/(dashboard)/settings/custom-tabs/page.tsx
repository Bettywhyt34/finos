import { redirect } from "next/navigation";

export default function CustomTabsRedirect() {
  redirect("/settings/customization/web-tabs");
}
