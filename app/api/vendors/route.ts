import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const vendors = await prisma.vendor.findMany({
    where: { tenantId },
    select: { id: true, companyName: true, vendorCode: true },
    orderBy: { companyName: "asc" },
  })

  return NextResponse.json({ vendors })
}
