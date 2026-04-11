/**
 * BettyWhyt sync processor.
 * server-only — uses Prisma, encrypted API key, and journal posting.
 *
 * Sync order:
 *   1. syncProducts() — upsert FINOS Item by SKU
 *   2. syncOrders()   — create Invoice + InvoiceLines + GL entry + InventoryMovements
 *
 * GL per order (5 lines):
 *   DR CA-003  (Bank)        total
 *   CR IN-0010 (Revenue)     subtotal
 *   CR CL-003  (VAT Payable) tax
 *   DR OE-005  (COGS)        totalCost
 *   CR AS-002  (Inventory)   totalCost
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { postJournalEntry } from "@/lib/journal";
import type { SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import { quarantineRecord, upsertCache } from "@/lib/integrations/sync-engine";
import {
  BettyWhytClient,
  BETTYWHYT_API_KEY_INVALID,
} from "./client";
import {
  parseCursor,
  stringifyCursor,
  type BWPOrder,
  type BWPProduct,
} from "./cdm";

type JsonObject = Prisma.InputJsonObject;

const SOURCE = "bettywhyt" as const;

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

export async function processBettywhyt(
  payload: SyncJobPayload
): Promise<Counts & { nextCursor?: string }> {
  const { tenantId, connectionId, syncLogId, cursor } = payload;

  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: { apiKeyEncrypted: true, apiUrl: true },
  });

  if (!connection.apiKeyEncrypted || !connection.apiUrl) {
    throw new Error("BettyWhyt connection missing API key or URL");
  }

  const apiKey = decrypt(connection.apiKeyEncrypted);
  const client = new BettyWhytClient(connection.apiUrl, apiKey);
  const since  = parseCursor(cursor).since;
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
    add(await syncOrders(client, tenantId, syncLogId, since));
  } catch (err) {
    if (err instanceof Error && err.message === BETTYWHYT_API_KEY_INVALID) {
      await prisma.integrationConnection.update({
        where: { id: connectionId },
        data:  { status: "ERROR", lastError: "API key invalid — please reconnect." },
      });
      throw new Error("BettyWhyt API key invalid — please reconnect the integration");
    }
    throw err;
  }

  return { ...totals, nextCursor: stringifyCursor({ since: newCursorTs }) };
}

// ─── Products ─────────────────────────────────────────────────────────────────

async function syncProducts(
  client:    BettyWhytClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await client.getProducts(since);

  for (const raw of data) {
    c.processed++;
    try {
      (await upsertProduct(orgId, raw)) === "created" ? c.created++ : c.updated++;
      await upsertCache(
        orgId, SOURCE, "products", raw.sku,
        raw as unknown as JsonObject,
      );
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "products", raw.sku,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

async function upsertProduct(orgId: string, raw: BWPProduct): Promise<"created" | "updated"> {
  const data = {
    name:      raw.name,
    description: raw.description ?? undefined,
    salesPrice: raw.price,
    costPrice:  raw.costPrice,
    qtyOnline:  raw.inventory.online,
    qtyPos:     raw.inventory.physical,
    qtyReserved: raw.inventory.reserved,
  };

  const existing = await prisma.item.findUnique({
    where:  { tenantId_itemCode: { tenantId: orgId, itemCode: raw.sku } },
    select: { id: true },
  });

  if (existing) {
    await prisma.item.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await prisma.item.create({
    data: {
      ...data,
      tenantId: orgId,
      itemCode:       raw.sku,
      type:           "INVENTORY",
    },
  });
  return "created";
}

// ─── Orders ───────────────────────────────────────────────────────────────────

async function syncOrders(
  client:    BettyWhytClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await client.getOrders(since);

  for (const raw of data) {
    c.processed++;
    try {
      const op = await upsertOrder(orgId, raw);
      op === "created" ? c.created++ : c.updated++;
      const { items: _items, ...orderMeta } = raw;
      await upsertCache(
        orgId, SOURCE, "orders", raw.orderNumber,
        orderMeta as unknown as JsonObject,
      );
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "orders", raw.orderNumber,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

async function upsertOrder(orgId: string, order: BWPOrder): Promise<"created" | "updated"> {
  // Check idempotency via invoiceNumber = orderNumber
  const existing = await prisma.invoice.findFirst({
    where:  { tenantId: orgId, invoiceNumber: order.orderNumber },
    select: { id: true },
  });
  if (existing) return "updated"; // already synced, skip re-posting

  // Resolve or create customer
  const customerId = await resolveOrCreateCustomer(orgId, order.customer);

  // Resolve items for line totals
  const orderDate = new Date(order.createdAt);
  const period    = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}`;

  // Create Invoice with lines in a transaction
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        tenantId:    orgId,
        invoiceNumber:     order.orderNumber,
        customerId,
        issueDate:         orderDate,
        dueDate:           orderDate, // online orders are paid immediately
        currency:          "NGN",
        exchangeRate:      1,
        subtotal:          order.totals.subtotal,
        discountAmount:    0,
        taxAmount:         order.totals.tax,
        totalAmount:       order.totals.total,
        amountPaid:        order.totals.total, // paid online
        balanceDue:        0,
        status:            "PAID",
        notes:             `BettyWhyt online order — payment: ${order.payment.method} / ${order.payment.transactionId}`,
        recognitionPeriod: period,
      },
    });

    for (const item of order.items) {
      // Best-effort: resolve FINOS item by SKU
      const finosItem = await tx.item.findUnique({
        where:  { tenantId_itemCode: { tenantId: orgId, itemCode: item.sku } },
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

    // Post GL journal: DR Bank / CR Revenue + VAT / DR COGS / CR Inventory
    const totalCost = order.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);

    await postJournalEntry({
      tenantId:    orgId,
      createdBy:         "bettywhyt-sync",
      entryDate:         orderDate,
      reference:         order.orderNumber,
      description:       `BettyWhyt online sale — order ${order.orderNumber}`,
      recognitionPeriod: period,
      source:            "bettywhyt",
      sourceId:          invoice.id,
      lines: [
        { accountCode: "CA-003",  description: "Online sale receipt",  debit: order.totals.total,    credit: 0 },
        { accountCode: "IN-0010", description: "E-commerce revenue",    debit: 0, credit: order.totals.subtotal },
        { accountCode: "CL-003",  description: "VAT on online sale",    debit: 0, credit: order.totals.tax },
        { accountCode: "OE-005",  description: "COGS — online sale",    debit: totalCost,             credit: 0 },
        { accountCode: "AS-002",  description: "Inventory reduction",   debit: 0, credit: totalCost },
      ],
    });

    // Log InventoryMovements per line item
    for (const item of order.items) {
      const finosItem = await tx.item.findUnique({
        where:  { tenantId_itemCode: { tenantId: orgId, itemCode: item.sku } },
        select: { id: true },
      });
      if (!finosItem) continue;

      await tx.inventoryMovement.create({
        data: {
          tenantId: orgId,
          itemId:         finosItem.id,
          movementType:   "SALE_ONLINE",
          channel:        "ONLINE",
          quantity:       -item.quantity, // outbound
          unitCost:       item.costPrice,
          reference:      order.orderNumber,
          sourceApp:      "bettywhyt",
          sourceId:       order.orderNumber,
          createdBy:      "bettywhyt-sync",
        },
      });

      // Decrement qty_online snapshot
      await tx.item.update({
        where: { id: finosItem.id },
        data:  { qtyOnline: { decrement: item.quantity } },
      });
    }
  });

  return "created";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveOrCreateCustomer(
  orgId: string,
  customer: { email: string; name: string; phone?: string }
): Promise<string> {
  const existing = await prisma.customer.findFirst({
    where:  { tenantId: orgId, email: customer.email },
    select: { id: true },
  });
  if (existing) return existing.id;

  const count = await prisma.customer.count({ where: { tenantId: orgId } });
  const code  = `BWP-${String(count + 1).padStart(4, "0")}`;

  const created = await prisma.customer.create({
    data: {
      tenantId: orgId,
      customerCode:   code,
      companyName:    customer.name,
      contactName:    customer.name,
      email:          customer.email,
      phone:          customer.phone ?? undefined,
    },
  });
  return created.id;
}
