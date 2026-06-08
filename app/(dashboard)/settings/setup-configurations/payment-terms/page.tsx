import { redirect }               from "next/navigation";
import { auth }                   from "@/lib/auth";
import { getPaymentTerms }        from "@/lib/setup-configurations/service";
import { PaymentTermsClient }     from "./payment-terms-client";

export default async function PaymentTermsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const terms = await getPaymentTerms(session.user.tenantId!);

  return <PaymentTermsClient initialTerms={terms} />;
}
