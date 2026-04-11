import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customers = await prisma.customer.findMany({
    where: { tenantId: orgId, isActive: true },
    include: {
      invoices: { select: { totalAmount: true, amountPaid: true } },
    },
    orderBy: { companyName: "asc" },
  });

  return NextResponse.json({
    customers: customers.map((c) => {
      const totalInvoiced = c.invoices.reduce((s, i) => s + parseFloat(String(i.totalAmount)), 0);
      const totalPaid = c.invoices.reduce((s, i) => s + parseFloat(String(i.amountPaid)), 0);
      return {
        id: c.id,
        customerCode: c.customerCode,
        companyName: c.companyName,
        contactName: c.contactName,
        email: c.email,
        phone: c.phone,
        paymentTerms: c.paymentTerms,
        totalInvoiced,
        totalPaid,
        balance: totalInvoiced - totalPaid,
      };
    }),
  });
}
