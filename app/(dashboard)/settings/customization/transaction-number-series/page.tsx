import { redirect }                     from "next/navigation";
import { auth }                        from "@/lib/auth";
import { getTransactionNumberSeries }  from "@/lib/customization/service";
import { TransactionNumberSeriesClient } from "./transaction-number-series-client";

export default async function TransactionNumberSeriesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const series = await getTransactionNumberSeries(session.user.tenantId!);

  return <TransactionNumberSeriesClient initialSeries={series} />;
}
