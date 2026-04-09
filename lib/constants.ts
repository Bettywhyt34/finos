export const APP_NAME = "FINOS v5.0";
export const DEFAULT_CURRENCY = "NGN";
export const DEFAULT_PAYMENT_TERMS = 30;

export const USER_ROLES = ["OWNER", "ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"] as const;

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "WRITTEN_OFF"] as const;

export const BILL_STATUSES = ["DRAFT", "RECORDED", "PARTIAL", "PAID", "OVERDUE"] as const;

export const EXPENSE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "REIMBURSED"] as const;

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CHECK", "CASH", "CARD"] as const;

export const ITEM_TYPES = ["INVENTORY", "SERVICE", "NON_STOCK"] as const;

// Nigerian Chart of Accounts standard codes
export const COA_AR_CODE = "CA-001";
export const COA_AP_CODE = "CL-001";
export const COA_BANK_CODE = "CA-003";
