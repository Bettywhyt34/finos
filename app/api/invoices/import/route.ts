import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { InvoiceImportRecord } from "@/lib/invoices/csv-map"

function getRecognitionPeriod(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { records } = (await req.json()) as { records: InvoiceImportRecord[] }

  // Pre-load customers for name matching (case-insensitive)
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, companyName: true },
  })
  const customerByName = new Map(
    customers.map((c) => [c.companyName.toLowerCase().trim(), c.id])
  )

  // Pre-load existing invoice numbers to detect duplicates
  const existingNumbers = new Set(
    (
      await prisma.invoice.findMany({
        where: { tenantId },
        select: { invoiceNumber: true },
      })
    ).map((i) => i.invoiceNumber)
  )

  let imported = 0
  let skipped = 0
  const errors: Array<{ invoiceNumber: string; error: string }> = []

  for (const rec of records) {
    if (!rec.invoiceNumber) {
      errors.push({ invoiceNumber: "(blank)", error: "Invoice number is required" })
      skipped++
      continue
    }

    if (!rec.customerName) {
      errors.push({ invoiceNumber: rec.invoiceNumber, error: "Customer name is required" })
      skipped++
      continue
    }

    // Customer lookup — case-insensitive exact match
    const customerId = customerByName.get(rec.customerName.toLowerCase().trim())
    if (!customerId) {
      errors.push({
        invoiceNumber: rec.invoiceNumber,
        error: `Customer not found: "${rec.customerName}" — create the customer first`,
      })
      skipped++
      continue
    }

    // Skip duplicates
    if (existingNumbers.has(rec.invoiceNumber)) {
      errors.push({
        invoiceNumber: rec.invoiceNumber,
        error: "Invoice number already exists — skipped",
      })
      skipped++
      continue
    }

    if (!rec.lines.length) {
      errors.push({ invoiceNumber: rec.invoiceNumber, error: "No line items found" })
      skipped++
      continue
    }

    try {
      const rate = rec.exchangeRate || 1
      const subtotal = rec.lines.reduce((s, l) => s + l.quantity * l.rate, 0)
      const taxAmount = rec.lines.reduce(
        (s, l) => s + l.quantity * l.rate * (l.taxRate / 100),
        0
      )
      const totalAmount = subtotal - rec.discountAmount + taxAmount

      await prisma.invoice.create({
        data: {
          tenantId,
          customerId,
          invoiceNumber: rec.invoiceNumber,
          reference: rec.reference ?? null,
          issueDate: new Date(rec.invoiceDate),
          dueDate: new Date(rec.dueDate),
          status: "DRAFT",
          currency: rec.currency,
          exchangeRate: rate,
          subtotal,
          discountAmount: rec.discountAmount,
          taxAmount,
          totalAmount,
          amountPaid: 0,         // payment data ignored on import
          balanceDue: totalAmount,
          recognitionPeriod: getRecognitionPeriod(rec.invoiceDate),
          notes: rec.notes ?? null,
          lines: {
            create: rec.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              rate: l.rate,
              amount: l.quantity * l.rate,
              taxRate: l.taxRate,
            })),
          },
        },
      })

      existingNumbers.add(rec.invoiceNumber)
      imported++
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ invoiceNumber: rec.invoiceNumber, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
