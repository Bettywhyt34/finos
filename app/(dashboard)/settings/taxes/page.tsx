import { redirect } from "next/navigation";

export default function LegacyTaxesPage() {
  redirect("/settings/taxes-compliance/taxes/rates");
}
