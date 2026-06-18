import { redirect }                  from "next/navigation";
import { auth }                      from "@/lib/auth";
import { getReportingTags }          from "@/lib/customization/reporting-tags-service";
import { ReportingTagsClient }       from "./reporting-tags-client";

export default async function ReportingTagsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tags = await getReportingTags(session.user.tenantId!);

  return <ReportingTagsClient initialTags={tags} />;
}
