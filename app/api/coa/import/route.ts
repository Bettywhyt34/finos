import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { CoaImportRow, topologicalSort } from "@/lib/coa/csv-map"

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { rows } = (await req.json()) as { rows: CoaImportRow[] }

  // Pre-load existing accounts for this tenant (code + name → id)
  const existing = await prisma.chartOfAccounts.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
  })
  const existingByCode = new Map(existing.map((a) => [a.code.toLowerCase(), a.id]))
  const existingByName = new Map(existing.map((a) => [a.name.toLowerCase().trim(), a.id]))

  // Topological sort ensures parents are inserted before children
  const ordered = topologicalSort(rows)

  // Name → ID map built as we insert — includes both pre-existing and newly created
  const nameToId = new Map(existing.map((a) => [a.name.toLowerCase().trim(), a.id]))

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ accountName: string; error: string }> = []

  for (const row of ordered) {
    if (!row.accountName.trim()) {
      errors.push({ accountName: "(blank)", error: "Account name is required" })
      skipped++
      continue
    }

    // Resolve parent ID from name
    let parentId: string | null = null
    if (row.parentAccountName) {
      const pid = nameToId.get(row.parentAccountName.toLowerCase().trim())
      if (!pid) {
        errors.push({
          accountName: row.accountName,
          error: `Parent account not found: "${row.parentAccountName}"`,
        })
        skipped++
        continue
      }
      parentId = pid
    }

    const data = {
      name: row.accountName.trim(),
      type: row.accountType,
      financialCategory: row.financialCategory ?? null,
      subtype: row.subtype ?? null,
      parentId,
      isActive: row.isActive,
      migrationStatus: "pending" as const,
    }

    try {
      const codeKey = row.accountCode.toLowerCase()
      const nameKey = row.accountName.toLowerCase().trim()

      const existingId = row.accountCode
        ? existingByCode.get(codeKey)
        : existingByName.get(nameKey)

      if (existingId) {
        await prisma.chartOfAccounts.update({
          where: { id: existingId },
          data: { ...data, code: row.accountCode || existingId.slice(0, 8) },
        })
        nameToId.set(nameKey, existingId)
        updated++
      } else {
        // Auto-generate code if blank
        const code = row.accountCode.trim() || await generateCode(tenantId, row.accountType)
        const created = await prisma.chartOfAccounts.create({
          data: { tenantId, code, ...data },
        })
        nameToId.set(nameKey, created.id)
        existingByCode.set(code.toLowerCase(), created.id)
        imported++
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ accountName: row.accountName, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, updated, skipped, errors })
}

// Auto-generate a code when the source CSV has none
async function generateCode(tenantId: string, type: string): Promise<string> {
  const prefix: Record<string, string> = {
    ASSET: "CA", LIABILITY: "CL", EQUITY: "EQ", INCOME: "IN", EXPENSE: "EX",
  }
  const p = prefix[type] ?? "AC"
  const count = await prisma.chartOfAccounts.count({ where: { tenantId } })
  return `${p}-${String(count + 1).padStart(3, "0")}`
}
