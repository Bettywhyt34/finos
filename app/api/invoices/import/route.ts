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

function safeDate(dateStr: string, field: string): Date | string {
  if (!dateStr || dateStr === "__invalid__") return `${field} is missing or unparseable — check the date column in your CSV`
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return `${field} "${dateStr}" could not be parsed — use DD/MM/YYYY`
  return d
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const role = session?.user?.role
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return NextResponse.json({ error: "You do not have permission to import invoices." }, { status: 403 })
  }

  const body = await req.json() as {
    records?: InvoiceImportRecord[]
    customerResolutions?: Record<string, CustomerResolution>
  }
  const records = Array.isArray(body.records) ? body.records : []
  const customerResolutions = body.customerResolutions ?? {}
  if (!records.length) return NextResponse.json({ error: "No invoice records were supplied." }, { status: 400 })
  if (records.length > 1000) return NextResponse.json({ error: "Import a maximum of 1,000 invoices at a time." }, { status: 400 })

  const existingCustomers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, companyName: true },
  })
  const customerByName = new Map(existingCustomers.map((c) => [c.companyName.toLowerCase().trim(), c.id]))
  const tenantCustomerIds = new Set(existingCustomers.map((c) => c.id))

  for (const [csvName, resolution] of Object.entries(customerResolutions)) {
    const key = csvName.toLowerCase().trim()
    if (!key) continue

    if (resolution.action === "map") {
      if (!tenantCustomerIds.has(resolution.customerId)) {
        return NextResponse.json({ error: `Customer mapping for "${csvName}" is invalid for this entity.` }, { status: 400 })
      }
      customerByName.set(key, resolution.customerId)
      continue
    }

    if (resolution.action === "create" && !customerByName.has(key)) {
      const created = await prisma.customer.create({
        data: {
          tenantId,
          companyName: csvName.trim(),
          customerCode: `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          paymentTerms: 30,
          currency: "NGN",
        },
        select: { id: true },
      })
      customerByName.set(key, created.id)
      tenantCustomerIds.add(created.id)
    }
  }

  let imported = 0
  let skipped = 0
  const errors: Array<{ invoiceNumber: string; error: string }> = []

  for (const rec of records) {
    const invoiceNumber = String(rec.invoiceNumber ?? "").trim()
    if (!invoiceNumber) {
      errors.push({ invoiceNumber: "(blank)", error: "Invoice number is required" })
      skipped++
      continue
    }
    if (invoiceNumber.length > 100) {
      errors.push({ invoiceNumber, error: "Invoice number is too long" })
      skipped++
      continue
    }

    const customerName = String(rec.customerName ?? "").trim()
    const customerId = customerByName.get(customerName.toLowerCase())
    if (!customerName || !customerId) {
      errors.push({ invoiceNumber, error: customerName ? `Customer not found: "${customerName}"` : "Customer name is required" })
      skipped++
      continue
    }

    const issueDate = safeDate(rec.invoiceDate, "Invoice date")
    const dueDate = safeDate(rec.dueDate, "Due date")
    if (typeof issueDate === "string") {
      errors.push({ invoiceNumber, error: issueDate }); skipped++; continue
    }
    if (typeof dueDate === "string") {
      errors.push({ invoiceNumber, error: dueDate }); skipped++; continue
    }
    if (dueDate < issueDate) {
      errors.push({ invoiceNumber, error: "Due date cannot be before invoice date" }); skipped++; continue
    }

    const currency = String(rec.currency || "NGN").trim().toUpperCase()
    const exchangeRate = Number(rec.exchangeRate ?? 1)
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ invoiceNumber, error: "Currency must be a valid 3-letter code" }); skipped++; continue
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      errors.push({ invoiceNumber, error: "Exchange rate must be greater than zero" }); skipped++; continue
    }
    if (currency === "NGN" && Math.abs(exchangeRate - 1) > 0.000001) {
      errors.push({ invoiceNumber, error: "NGN invoices must use an exchange rate of 1" }); skipped++; continue
    }

    if (!Array.isArray(rec.lines) || !rec.lines.length || rec.lines.length > 200) {
      errors.push({ invoiceNumber, error: rec.lines?.length ? "An invoice cannot contain more than 200 lines" : "No line items found" })
      skipped++
      continue
    }

    let invalidLine: string | null = null
    const normalisedLines = rec.lines.map((line, index) => {
      const description = String(line.description ?? "").trim()
      const quantity = Number(line.quantity)
      const rate = Number(line.rate)
      const taxRate = Number(line.taxRate ?? 0)
      if (!description) invalidLine ??= `Line ${index + 1} needs a description`
      if (!Number.isFinite(quantity) || quantity <= 0) invalidLine ??= `Line ${index + 1} quantity must be greater than zero`
      if (!Number.isFinite(rate) || rate < 0) invalidLine ??= `Line ${index + 1} rate cannot be negative`
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) invalidLine ??= `Line ${index + 1} tax rate must be between 0% and 100%`
      const amount = roundMoney(quantity * rate)
      const taxAmount = roundMoney(amount * taxRate / 100)
      return { description, quantity, rate, taxRate, amount, taxAmount }
    })
    if (invalidLine) {
      errors.push({ invoiceNumber, error: invalidLine }); skipped++; continue
    }

    const subtotal = roundMoney(normalisedLines.reduce((sum, line) => sum + line.amount, 0))
    const taxAmount = roundMoney(normalisedLines.reduce((sum, line) => sum + line.taxAmount, 0))
    const discountAmount = roundMoney(Number(rec.discountAmount ?? 0))
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount - subtotal > 0.01) {
      errors.push({ invoiceNumber, error: "Invoice discount must be between zero and the subtotal" }); skipped++; continue
    }
    const totalAmount = roundMoney(subtotal - discountAmount + taxAmount)

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice-import:${tenantId}:${invoiceNumber}`}))`

        const duplicate = await tx.invoice.findFirst({
          where: rec.externalTxnId
            ? { tenantId, OR: [{ externalTxnId: rec.externalTxnId }, { invoiceNumber }] }
            : { tenantId, invoiceNumber },
          select: { id: true },
        })
        if (duplicate) throw new Error(rec.externalTxnId ? "Invoice number or Transaction ID already exists — skipped" : "Invoice number already exists — skipped")

        await tx.invoice.create({
          data: {
            tenantId,
            customerId,
            invoiceNumber,
            reference: rec.reference?.trim() || null,
            issueDate,
            dueDate,
            status: "DRAFT",
            currency,
            exchangeRate,
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            amountPaid: 0,
            balanceDue: totalAmount,
            recognitionPeriod: getRecognitionPeriod(rec.invoiceDate),
            notes: rec.notes?.trim() || null,
            externalTxnId: rec.externalTxnId?.trim() || null,
            lines: {
              create: normalisedLines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                rate: line.rate,
                amount: line.amount,
                taxRate: line.taxRate,
                taxAmount: line.taxAmount,
                lineTotal: roundMoney(line.amount + line.taxAmount),
              })),
            },
          },
        })
      })
      imported++
    } catch (err: unknown) {
      errors.push({ invoiceNumber, error: err instanceof Error ? err.message : "Unknown error" })
      skipped++
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
