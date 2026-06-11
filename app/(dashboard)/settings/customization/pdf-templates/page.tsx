import { redirect }          from "next/navigation";
import { auth }              from "@/lib/auth";
import { getPdfTemplates }   from "@/lib/customization/pdf-service";
import { PdfTemplatesClient } from "./pdf-templates-client";

export default async function PdfTemplatesPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const type = (searchParams.type ?? "INVOICE").toUpperCase();
  const templates = await getPdfTemplates(session.user.tenantId!, type);

  return (
    <PdfTemplatesClient
      key={type}
      initialTemplates={templates}
      initialType={type}
    />
  );
}
