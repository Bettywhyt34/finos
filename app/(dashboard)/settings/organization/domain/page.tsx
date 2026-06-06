import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DomainClient } from "./domain-client";

export const metadata = { title: "Custom Domain — FINOS Books" };

export default async function DomainPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  return (
    <DomainClient
      orgName={session.user.tenantName ?? "Your Organisation"}
    />
  );
}
