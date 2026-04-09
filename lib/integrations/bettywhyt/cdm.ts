/**
 * BettyWhyt Common Data Model (CDM)
 * Type definitions for data exchanged with the BettyWhyt Perfumes platform.
 */

export interface BWPProduct {
  sku:          string;
  name:         string;
  description?: string;
  price:        number;
  costPrice:    number;
  category?:    string;
  inventory: {
    online:   number;
    physical: number;
    reserved: number;
  };
}

export interface BWPOrderItem {
  sku:       string;
  name:      string;
  quantity:  number;
  price:     number;
  costPrice: number;
}

export interface BWPOrder {
  orderNumber: string;
  customer: {
    email:  string;
    name:   string;
    phone?: string;
  };
  items: BWPOrderItem[];
  payment: {
    method:        string;
    transactionId: string;
    paidAt:        string;
  };
  totals: {
    subtotal: number;
    tax:      number;
    shipping: number;
    total:    number;
  };
  source:    string; // "bettywhyt_online"
  createdAt: string;
}

export interface BWPStockUpdate {
  sku:        string;
  type:       "RECEIPT" | "ADJUSTMENT" | "RESERVATION" | "RELEASE";
  channel:    "ONLINE" | "POS" | "BOTH";
  quantity:   number; // positive = in, negative = out
  reference?: string;
  unitCost?:  number;
}

/** Cursor stored in SyncLog.cursorTo between incremental syncs */
export interface BWPCursor {
  since: string; // ISO datetime of last successful sync
}

export function parseCursor(cursor?: string): BWPCursor {
  if (!cursor) return { since: new Date(0).toISOString() };
  try {
    return JSON.parse(cursor) as BWPCursor;
  } catch {
    return { since: new Date(0).toISOString() };
  }
}

export function stringifyCursor(c: BWPCursor): string {
  return JSON.stringify(c);
}
