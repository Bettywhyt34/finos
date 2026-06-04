import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  coaToFinosRow,
  coaToZohoRow,
  FINOS_COA_HEADERS,
  ZOHO_COA_HEADERS,
  toCsv,
} from "@/lib/coa/csv-map"

export async function GET(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const format = req.nextUrl.searchParams.get("format") ?? "finos"
  const date = new Date().toISOString().slice(0, 10)

  // Include parent relation for hierarchy flattening
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId },
    include: { parent: { select: { name: true } } },
    orderBy: { code: "asc" },
  })

  let csv: string
  let filename: string

  if (format === "zoho") {
    csv = toCsv(ZOHO_COA_HEADERS, accounts.map(coaToZohoRow))
    filename = `chart-of-accounts-zoho-${date}.csv`
  } else {
    csv = toCsv(FINOS_COA_HEADERS, accounts.map(coaToFinosRow))
    filename = `chart-of-accounts-finos-${date}.csv`
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
