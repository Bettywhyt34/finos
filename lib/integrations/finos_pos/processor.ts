/**
 * FINOS POS sync processor.
 * server-only — uses Prisma, encrypted API key, and journal posting.
 *
 * Sync order:
 *   1. syncProducts() — upsert FINOS Item by SKU
 *   2. syncSales()    — create Invoice + InvoiceLines + GL entry + InventoryMovements
 *
 * GL per POS sale (5 lines):
 *   DR CA-003  (Bank / POS Terminal)  total
 *   CR IN-0011 (POS Revenue)          subtotal
 *   CR CL-003  (VAT Payable)          tax
 *   DR OE-005  (COGS)                 totalCost
 *   CR AS-002  (Inventory Asset)      totalCost
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { postJournalEntry } from "@/lib/journal";
import type { SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import { quarantineRecord, upsertCache } from "@/lib/integrations/sync-engine";
import { FinosPosClient, FINOS_POS_API_KEY_INVALID } from "./client";
import {
  parsePOSCursor,
  stringifyPOSCursor,
  type POSSale,
  type POSProduct,
} from "./cdm";

type JsonObject = Prisma.InputJsonObject;

const SOURCE = "finos_pos" as const;

type Counts = {
  processed:   number;
  created:     number;
  updated:     number;
  failed:      number;
  quarantined: number;
};

function zero(): Counts {
  return { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function processFinosPos(
  payload: SyncJobPayload
): Promise<Counts & { nextCursor?: string }> {
  const { tenantId, connectionId, syncLogId, cursor } = payload;

  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: { apiKeyEncrypted: true, apiUrl: true },
  });

  if (!connection.apiKeyEncrypted || !connection.apiUrl) {
    throw new Error("FINOS POS connection missing API key or URL");
  }

  const apiKey = decrypt(connection.apiKeyEncrypted);
  const client = new FinosPosClient(connection.apiUrl, apiKey);
  const since  = parsePOSCursor(cursor).since;
  const newCursorTs = new Date().toISOString();

  const totals: Counts = zero();
  const add = (c: Counts) => {
    totals.processed   += c.processed;
    totals.created     += c.created;
    totals.updated     += c.updated;
    totals.failed      += c.failed;
    totals.quarantined += c.quarantined;
  };

  try {
    add(await syncProducts(client, tenantId, syncLogId, since));
    add(await syncSales(client, tenantId, syncLogId, since));
  } catch (err) {
    if (err instanceof Error && err.message === FINOS_POS_API_KEY_INVALID) {
      await prisma.integrationConnection.update({
        where: { id: connectionId },
        data:  { status: "ERROR", lastError: "API key invalid — please reconnect." },
      });
      throw new Error("FINOS POS API key invalid — please reconnect the integration");
    }
    throw err;
  }

  return { ...totals, nextCursor: stringifyPOSCursor({ since: newCursorTs }) };
}

// ─── Products ─────────────────────────────────────────────────────────────────

async function syncProducts(
  client:    FinosPosClient,
  tenantId:  string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await client.getProducts(since);

  for (const raw of data) {
    c.processed++;
    try {
      const op = await upsertItem(tenantId, raw);
      op === "created" ? c.created++ : c.updated++;
      await upsertCache(tenantId, SOURCE, "products", raw.sku, raw as unknown as JsonObject);
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        tenantId, syncLogId, SOURCE, "products", raw.sku,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

async function upsertItem(tenantId: string, raw: POSProduct): Promise<"created" | "updated"> {
  const data = {
    name:        raw.name,
    description: raw.description ?? undefined,
    salesPrice:  raw.price,
    costPrice:   raw.costPrice,
    qtyOnline:   raw.inventory.online,
    qtyPos:      raw.inventory.physical,
    qtyReserved: raw.inventory.reserved,
  };

  const existing = await prisma.item.findUnique({
    where:  { tenantId_itemCode: { tenantId, itemCode: raw.sku } },
    select: { id: true },
  });

  if (existing) {
    await prisma.item.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await prisma.item.create({
    data: { ...data, tenantId, itemCode: raw.sku, type: "INVENTORY" },
  });
  return "created";
}

// ─── Sales ────────────────────────────────────────────────────────────────────

async function syncSales(
  client:    FinosPosClient,
  tenantId:  string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await client.getSales(since);

  for (const raw of data) {
    c.processed++;
    try {
      const op = await upsertSale(tenantId, raw);
      op === "created" ? c.created++ : c.updated++;
      const { items: _items, ...saleMeta } = raw;
      await upsertCache(
        tenantId, SOURCE, "sales", raw.saleNumber,
        saleMeta as unknown as JsonObject,
      );
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        tenantId, syncLogId, SOURCE, "sales", raw.saleNumber,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

async function upsertSale(tenantId: string, sale: POSSale): Promise<"created" | "updated"> {
  // Idempotency: check by invoiceNumber = saleNumber
  const existing = await prisma.invoice.findFirst({
    where:  { tenantId, invoiceNumber: sale.saleNumber },
    select: { id: true },
  });
  if (existing) return "updated";

  // Resolve or create walk-in customer for POS
  const customerId = await resolveWalkInCustomer(tenantId);

  const saleDate = new Date(sale.createdAt);
  const period   = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, "0")}`;

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        invoiceNumber:     sale.saleNumber,
        customerId,
        issueDate:         saleDate,
        dueDate:           saleDate, // POS sales are immediate
        currency:          "NGN",
        exchangeRate:      1,
        subtotal:          sale.totals.subtotal,
        discountAmount:    0,
        taxAmount:         sale.totals.tax,
        totalAmount:       sale.totals.total,
        amountPaid:        sale.totals.total,
        balanceDue:        0,
        status:            "PAID",
        notes:             `FINOS POS — terminal: ${sale.terminal} / cashier: ${sale.cashier} / method: ${sale.payment.method}`,
        recognitionPeriod: period,
      },
    });

    for (const item of sale.items) {
      const finosItem = await tx.item.findUnique({
        where:  { tenantId_itemCode: { tenantId, itemCode: item.sku } },
        select: { id: true },
      });

      await tx.invoiceLine.create({
        data: {
          invoiceId:   invoice.id,
          itemId:      finosItem?.id ?? undefined,
          description: item.name,
          quantity:    item.quantity,
          rate:        item.price,
          amount:      item.quantity * item.price,
        },
      });
    }

    const totalCost = sale.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);

    await postJournalEntry({
      tenantId,
      createdBy:         "finos-pos-sync",
      entryDate:         saleDate,
      reference:         sale.saleNumber,
      description:       `FINOS POS sale — ${sale.saleNumber} (${sale.terminal})`,
      recognitionPeriod: period,
      source:            "finos_pos",
      sourceId:          invoice.id,
      lines: [
        { accountCode: "CA-003",  description: "POS cash/card receipt",  debit: sale.totals.total,    credit: 0 },
        { accountCode: "IN-0011", description: "POS sales revenue",       debit: 0, credit: sale.totals.subtotal },
        { accountCode: "CL-003",  description: "VAT on POS sale",         debit: 0, credit: sale.totals.tax },
        { accountCode: "OE-005",  description: "COGS — POS sale",         debit: totalCost,            credit: 0 },
        { accountCode: "AS-002",  description: "Inventory reduction",      debit: 0, credit: totalCost },
      ],
    });

    for (const item of sale.items) {
      const finosItem = await tx.item.findUnique({
        where:  { tenantId_itemCode: { tenantId, itemCode: item.sku } },
        select: { id: true },
      });
      if (!finosItem) continue;

      await tx.inventoryMovement.create({
        data: {
          tenantId,
          itemId:       finosItem.id,
          movementType: "SALE_POS",
          channel:      "POS",
          quantity:     -item.quantity,
          unitCost:     item.costPrice,
          reference:    sale.saleNumber,
          sourceApp:    "finos_pos",
          sourceId:     sale.saleNumber,
          createdBy:    "finos-pos-sync",
        },
      });

      await tx.item.update({
        where: { id: finosItem.id },
        data:  { qtyPos: { decrement: item.quantity } },
      });
    }
  });

  return "created";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveWalkInCustomer(tenantId: string): Promise<string> {
  const existing = await prisma.customer.findFirst({
    where:  { tenantId, customerCode: "POS-WALKIN" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.customer.create({
    data: {
      tenantId,
      customerCode: "POS-WALKIN",
      companyName:  "POS Walk-in Customer",
      contactName:  "Walk-in",
    },
  });
  return created.id;
}
