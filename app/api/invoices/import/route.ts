import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { InvoiceImportRecord } from "@/lib/invoices/csv-map"

type CustomerResolution =
  | { action: "map"; customerId: string }
  | { action: "create" }

function getRecognitionPeriod(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function safeDate(dateStr: string, invoiceNumber: string, field: string): Date | string {
  if (!dateStr || dateStr === "__invalid__") {
    return `${field} is missing or unparseable — check the date column in your CSV`
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) {
    return `${field} "${dateStr}" could not be parsed — use DD/MM/YYYY`
  }
  return d
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json() as {
    records: InvoiceImportRecord[]
    customerResolutions?: Record<string, CustomerResolution>
  }
  const { records, customerResolutions = {} } = body

  // Pre-load customers for name matching (case-insensitive)
  const existingCustomers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, companyName: true },
  })
  const customerByName = new Map(
    existingCustomers.map((c) => [c.companyName.toLowerCase().trim(), c.id])
  )

  // Apply resolutions: create new customers first, then add to map
  for (const [csvName, resolution] of Object.entries(customerResolutions)) {
    const key = csvName.toLowerCase().trim()
    if (resolution.action === "map") {
      customerByName.set(key, resolution.customerId)
    } else if (resolution.action === "create") {
      // Only create if still not in map (avoid double-create on retry)
      if (!customerByName.has(key)) {
        const created = await prisma.customer.create({
          data: {
            tenantId,
            companyName: csvName.trim(),
            customerCode: `CUST-${Date.now()}`,
            paymentTerms: 30,
            currency: "NGN",
          },
        })
        customerByName.set(key, created.id)
      }
    }
  }

  // Pre-load existing invoice numbers to detect duplicates
  const existingInvoices = await prisma.invoice.findMany({
    where: { tenantId },
    select: { invoiceNumber: true, externalTxnId: true },
  })
  const existingNumbers = new Set(existingInvoices.map((i) => i.invoiceNumber))
  const existingTxnIds = new Set(
    existingInvoices
      .filter((i) => i.externalTxnId)
      .map((i) => i.externalTxnId as string)
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

    // Customer lookup
    const customerId = customerByName.get(rec.customerName.toLowerCase().trim())
    if (!customerId) {
      errors.push({
        invoiceNumber: rec.invoiceNumber,
        error: `Customer not found: "${rec.customerName}"`,
      })
      skipped++
      continue
    }

    // Deduplication
    if (rec.externalTxnId) {
      if (existingTxnIds.has(rec.externalTxnId)) {
        errors.push({
          invoiceNumber: rec.invoiceNumber,
          error: `Transaction ID "${rec.externalTxnId}" already imported — skipped`,
        })
        skipped++
        continue
      }
    } else {
      if (existingNumbers.has(rec.invoiceNumber)) {
        errors.push({
          invoiceNumber: rec.invoiceNumber,
          error: "Invoice number already exists — skipped",
        })
        skipped++
        continue
      }
    }

    if (!rec.lines.length) {
      errors.push({ invoiceNumber: rec.invoiceNumber, error: "No line items found" })
      skipped++
      continue
    }

    // Date validation — fail early with a clear message
    const issueDate = safeDate(rec.invoiceDate, rec.invoiceNumber, "Invoice date")
    const dueDate = safeDate(rec.dueDate, rec.invoiceNumber, "Due date")
    if (typeof issueDate === "string") {
      errors.push({ invoiceNumber: rec.invoiceNumber, error: issueDate })
      skipped++
      continue
    }
    if (typeof dueDate === "string") {
      errors.push({ invoiceNumber: rec.invoiceNumber, error: dueDate })
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
          issueDate,
          dueDate,
          status: "DRAFT",
          currency: rec.currency,
          exchangeRate: rate,
          subtotal,
          discountAmount: rec.discountAmount,
          taxAmount,
          totalAmount,
          amountPaid: 0,
          balanceDue: totalAmount,
          recognitionPeriod: getRecognitionPeriod(rec.invoiceDate),
          notes: rec.notes ?? null,
          campaignId: rec.campaignId ?? null,
          externalTxnId: rec.externalTxnId ?? null,
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
      if (rec.externalTxnId) existingTxnIds.add(rec.externalTxnId)
      imported++
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ invoiceNumber: rec.invoiceNumber, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
