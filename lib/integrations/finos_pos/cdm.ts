/**
 * FINOS POS Common Data Model (CDM)
 * Type definitions for data exchanged with the FINOS POS system.
 */

export interface POSProduct {
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

export interface POSSaleItem {
  sku:       string;
  name:      string;
  quantity:  number;
  price:     number;
  costPrice: number;
}

export interface POSSale {
  saleNumber: string;
  cashier:    string;
  terminal:   string;
  items:      POSSaleItem[];
  payment: {
    method:        string; // CASH | CARD | TRANSFER
    reference?:    string;
    paidAt:        string; // ISO datetime
  };
  totals: {
    subtotal: number;
    tax:      number;
    total:    number;
  };
  createdAt: string; // ISO datetime
}

/** Cursor stored between incremental syncs */
export interface POSCursor {
  since: string; // ISO datetime of last successful sync
}

export function parsePOSCursor(cursor?: string): POSCursor {
  if (!cursor) return { since: new Date(0).toISOString() };
  try {
    return JSON.parse(cursor) as POSCursor;
  } catch {
    return { since: new Date(0).toISOString() };
  }
}

export function stringifyPOSCursor(c: POSCursor): string {
  return JSON.stringify(c);
}
