import { redirect } from "next/navigation";

// Redirect legacy path → canonical customization path
export default function TemplatesRedirect() {
  redirect("/settings/customization/pdf-templates");
}
