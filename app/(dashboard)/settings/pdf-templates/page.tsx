import { redirect } from "next/navigation";

// Redirect old path → canonical customization path
export default function PdfTemplatesRedirect() {
  redirect("/settings/customization/pdf-templates");
}
