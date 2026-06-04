import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  invoiceToFinosRows,
  invoiceToZohoRows,
  FINOS_INVOICE_HEADERS,
  ZOHO_INVOICE_HEADERS,
  toCsv,
} from "@/lib/invoices/csv-map"

export async function GET(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const format = req.nextUrl.searchParams.get("format") ?? "finos"
  const date = new Date().toISOString().slice(0, 10)

  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    include: {
      customer: {
        select: {
          companyName: true,
          paymentTerms: true,
          billingAddress: true,
          billingCity: true,
          billingState: true,
          billingCountry: true,
          billingPostalCode: true,
        },
      },
      lines: {
        select: {
          description: true,
          quantity: true,
          rate: true,
          amount: true,
          taxRate: true,
        },
      },
    },
    orderBy: { issueDate: "desc" },
  })

  let csv: string
  let filename: string

  if (format === "zoho") {
    const rows = invoices.flatMap(invoiceToZohoRows)
    csv = toCsv(ZOHO_INVOICE_HEADERS, rows)
    filename = `invoices-zoho-${date}.csv`
  } else {
    const rows = invoices.flatMap(invoiceToFinosRows)
    csv = toCsv(FINOS_INVOICE_HEADERS, rows)
    filename = `invoices-finos-${date}.csv`
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
