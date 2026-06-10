import { redirect } from "next/navigation";

/**
 * Legacy route redirect.
 * /settings/opening-balances → /settings/setup-configurations/opening-balances
 */
export default function OpeningBalancesRedirect() {
  redirect("/settings/setup-configurations/opening-balances");
}
