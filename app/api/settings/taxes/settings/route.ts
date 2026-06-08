/**
 * GET  /api/settings/taxes/settings  — return default tax settings (not persisted)
 * PATCH /api/settings/taxes/settings — 501 stub
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const DEFAULTS = {
  taxRegistrationLabel:   "VAT Reg No",
  taxRegistrationNumber:  "",
  whtEnabled:             true,
  reverseChargeSales:     false,
  reverseChargePurchases: false,
  trackingMode:           "single" as const,
  overrideSales:          false,
  overridePurchases:      false,
  _note:                  "Tax settings are not persisted yet.",
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(DEFAULTS);
}

export async function PATCH() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Tax settings backend is not connected yet." },
    { status: 501 },
  );
}
