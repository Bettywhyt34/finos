/**
 * BettyWhyt inbound webhook handler.
 * Processes real-time events pushed from BettyWhyt to FINOS.
 *
 * Events:
 *   order.placed       → create Invoice + GL + InventoryMovements
 *   stock.received     → create InventoryMovement (RECEIPT)
 *   stock.adjusted     → create InventoryMovement (ADJUSTMENT)
 *   product.created    → upsert FINOS Item
 *   product.updated    → upsert FINOS Item
 *
 * server-only
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import type { BWPOrder, BWPProduct, BWPStockUpdate } from "./cdm";

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleBettywhytWebhook(
  event:   string,
  payload: unknown,
  orgId:   string
): Promise<void> {
  switch (event) {
    case "order.placed":
      await handleOrderPlaced(payload as BWPOrder, orgId);
      break;
    case "stock.received":
      await handleStockReceipt(payload as BWPStockUpdate, orgId);
      break;
    case "stock.adjusted":
      await handleStockAdjust(payload as BWPStockUpdate, orgId);
      break;
    case "product.created":
    case "product.updated":
      await handleProductUpdate(payload as BWPProduct, orgId);
      break;
    default:
      console.warn(`[bettywhyt-webhook] Unknown event: ${event}`);
  }
}

// ─── Order placed ─────────────────────────────────────────────────────────────

async function handleOrderPlaced(order: BWPOrder, orgId: string): Promise<void> {
  // Idempotency guard
  const exists = await prisma.invoice.findFirst({
    where:  { tenantId: orgId, invoiceNumber: order.orderNumber },
    select: { id: true },
  });
  if (exists) return;

  const customerId = await resolveOrCreateCustomer(orgId, order.customer);
  const orderDate  = new Date(order.createdAt);
  const period     = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}`;
  const totalCost  = order.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        tenantId:    orgId,
        invoiceNumber:     order.orderNumber,
        customerId,
        issueDate:         orderDate,
        dueDate:           orderDate,
        currency:          "NGN",
        exchangeRate:      1,
        subtotal:          order.totals.subtotal,
        discountAmount:    0,
        taxAmount:         order.totals.tax,
        totalAmount:       order.totals.total,
        amountPaid:        order.totals.total,
        balanceDue:        0,
        status:            "PAID",
        notes:             `BettyWhyt online order — ${order.payment.method} / ${order.payment.transactionId}`,
        recognitionPeriod: period,
      },
    });

    for (const item of order.items) {
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

    await postJournalEntry({
      tenantId:    orgId,
      createdBy:         "bettywhyt-webhook",
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
          quantity:       -item.quantity,
          unitCost:       item.costPrice,
          reference:      order.orderNumber,
          sourceApp:      "bettywhyt",
          sourceId:       order.orderNumber,
          createdBy:      "bettywhyt-webhook",
        },
      });

      await tx.item.update({
        where: { id: finosItem.id },
        data:  { qtyOnline: { decrement: item.quantity } },
      });
    }
  });
}

// ─── Stock received ───────────────────────────────────────────────────────────

async function handleStockReceipt(update: BWPStockUpdate, orgId: string): Promise<void> {
  const finosItem = await prisma.item.findUnique({
    where:  { tenantId_itemCode: { tenantId: orgId, itemCode: update.sku } },
    select: { id: true },
  });
  if (!finosItem) {
    console.warn(`[bettywhyt-webhook] stock.received: item ${update.sku} not found in FINOS`);
    return;
  }

  const qtyField = update.channel === "ONLINE" ? "qtyOnline"
    : update.channel === "POS" ? "qtyPos"
    : undefined; // BOTH handled individually below

  await prisma.$transaction(async (tx) => {
    await tx.inventoryMovement.create({
      data: {
        tenantId: orgId,
        itemId:         finosItem.id,
        movementType:   "RECEIPT",
        channel:        update.channel,
        quantity:       update.quantity,
        unitCost:       update.unitCost ?? undefined,
        reference:      update.reference ?? undefined,
        sourceApp:      "bettywhyt",
        sourceId:       update.reference ?? undefined,
        createdBy:      "bettywhyt-webhook",
      },
    });

    if (qtyField) {
      await tx.item.update({
        where: { id: finosItem.id },
        data:  { [qtyField]: { increment: update.quantity } },
      });
    } else {
      // BOTH channels
      await tx.item.update({
        where: { id: finosItem.id },
        data:  { qtyOnline: { increment: update.quantity }, qtyPos: { increment: update.quantity } },
      });
    }
  });
}

// ─── Stock adjusted ───────────────────────────────────────────────────────────

async function handleStockAdjust(update: BWPStockUpdate, orgId: string): Promise<void> {
  const finosItem = await prisma.item.findUnique({
    where:  { tenantId_itemCode: { tenantId: orgId, itemCode: update.sku } },
    select: { id: true },
  });
  if (!finosItem) {
    console.warn(`[bettywhyt-webhook] stock.adjusted: item ${update.sku} not found in FINOS`);
    return;
  }

  const qtyField = update.channel === "ONLINE" ? "qtyOnline"
    : update.channel === "POS"    ? "qtyPos"
    : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.inventoryMovement.create({
      data: {
        tenantId: orgId,
        itemId:         finosItem.id,
        movementType:   "ADJUSTMENT",
        channel:        update.channel,
        quantity:       update.quantity,
        unitCost:       update.unitCost ?? undefined,
        reference:      update.reference ?? undefined,
        sourceApp:      "bettywhyt",
        sourceId:       update.reference ?? undefined,
        createdBy:      "bettywhyt-webhook",
      },
    });

    if (qtyField) {
      await tx.item.update({
        where: { id: finosItem.id },
        data:  { [qtyField]: { increment: update.quantity } },
      });
    } else {
      await tx.item.update({
        where: { id: finosItem.id },
        data:  { qtyOnline: { increment: update.quantity }, qtyPos: { increment: update.quantity } },
      });
    }
  });
}

// ─── Product upsert ───────────────────────────────────────────────────────────

async function handleProductUpdate(product: BWPProduct, orgId: string): Promise<void> {
  const data = {
    name:        product.name,
    description: product.description ?? undefined,
    salesPrice:  product.price,
    costPrice:   product.costPrice,
    qtyOnline:   product.inventory.online,
    qtyPos:      product.inventory.physical,
    qtyReserved: product.inventory.reserved,
  };

  const existing = await prisma.item.findUnique({
    where:  { tenantId_itemCode: { tenantId: orgId, itemCode: product.sku } },
    select: { id: true },
  });

  if (existing) {
    await prisma.item.update({ where: { id: existing.id }, data });
  } else {
    await prisma.item.create({
      data: { ...data, tenantId: orgId, itemCode: product.sku, type: "INVENTORY" },
    });
  }
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
