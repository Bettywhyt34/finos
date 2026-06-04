import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  customerToFinosRow,
  customerToZohoRow,
  FINOS_CSV_HEADERS,
  ZOHO_CSV_HEADERS,
  toCsv,
} from "@/lib/customers/csv-map"

export async function GET(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const format = req.nextUrl.searchParams.get("format") ?? "finos"
  const date = new Date().toISOString().slice(0, 10)

  const customers = await prisma.customer.findMany({
    where: { tenantId },
    orderBy: { companyName: "asc" },
  })

  let csv: string
  let filename: string

  if (format === "zoho") {
    csv = toCsv(ZOHO_CSV_HEADERS, customers.map(customerToZohoRow))
    filename = `customers-zoho-${date}.csv`
  } else {
    csv = toCsv(FINOS_CSV_HEADERS, customers.map(customerToFinosRow))
    filename = `customers-finos-${date}.csv`
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
