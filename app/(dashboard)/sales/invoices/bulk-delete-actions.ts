"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function bulkDeleteInvoicesSafely(ids: string[]) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return { error: "Unauthorized" };

  const requestedIds = Array.from(new Set(ids.filter(Boolean))).slice(0, 500);
  if (!requestedIds.length) return { deleted: 0, skipped: 0, protected: 0 };

  const invoices = await prisma.invoice.findMany({
    where: { tenantId, id: { in: requestedIds } },
    select: { id: true, status: true },
  });

  const draftIds = invoices.filter((invoice) => invoice.status === "DRAFT").map((invoice) => invoice.id);
  if (!draftIds.length) {
    return { deleted: 0, skipped: requestedIds.length, protected: 0 };
  }

  const protectedRows = await prisma.$queryRaw<Array<{ invoiceId: string }>>`
    SELECT "converted_invoice_id" AS "invoiceId"
    FROM "quotes"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "status" = 'CONVERTED'
      AND "converted_invoice_id" IN (${Prisma.join(draftIds)})
  `;
  const protectedIds = new Set(protectedRows.map((row) => row.invoiceId));
  const deletableIds = draftIds.filter((id) => !protectedIds.has(id));

  if (!deletableIds.length) {
    return {
      deleted: 0,
      skipped: requestedIds.length,
      protected: protectedIds.size,
    };
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: deletableIds } } });
    return tx.invoice.deleteMany({
      where: { id: { in: deletableIds }, tenantId, status: "DRAFT" },
    });
  });

  revalidatePath("/sales/invoices");
  return {
    deleted: deleted.count,
    skipped: requestedIds.length - deleted.count,
    protected: protectedIds.size,
  };
}
