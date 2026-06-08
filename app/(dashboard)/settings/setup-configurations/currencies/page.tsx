import { redirect }          from "next/navigation";
import { auth }              from "@/lib/auth";
import { getCurrencies }     from "@/lib/setup-configurations/service";
import { CurrenciesClient }  from "./currencies-client";

export default async function CurrenciesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const data = await getCurrencies(session.user.tenantId!);

  return (
    <CurrenciesClient
      baseCurrency={data.baseCurrency}
      currencies={data.currencies}
    />
  );
}
