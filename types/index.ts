export type { Tenant, User, UserRole } from "@prisma/client";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
