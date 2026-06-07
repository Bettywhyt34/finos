/**
 * Client-side service layer for the Roles module.
 * System roles are always present (5 static UserRole enum values).
 * Custom roles are not yet implemented — API returns 501 for create/duplicate.
 */

export type UserRole  = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER";
export type RoleType  = "system" | "custom";

export interface SystemRole {
  id:            UserRole;
  label:         string;
  description:   string;
  color:         string;
  type:          RoleType;
  canManageUsers: boolean;
  accessLevel:   "full" | "standard" | "accounting" | "operational" | "readonly";
  sensitive:     boolean;
}

export interface RoleWithStats extends SystemRole {
  /** Active members assigned to this role. */
  userCount:     number;
  /** Inactive members assigned to this role. */
  inactiveCount: number;
  createdAt:     null;
  updatedAt:     null;
}

export interface PermissionGroup {
  id:          string;
  label:       string;
  description: string;
  enforced:    boolean;
  grantedTo:   UserRole[];
}

// ─── Canonical system role definitions ─────────────────────────────────────────

export const SYSTEM_ROLE_DEFINITIONS: Record<UserRole, Omit<SystemRole, "id">> = {
  OWNER: {
    label:          "Owner",
    description:    "Full administrative access. Owns the organisation account.",
    color:          "bg-violet-50 text-violet-700 border border-violet-200",
    type:           "system",
    canManageUsers: true,
    accessLevel:    "full",
    sensitive:      true,
  },
  ADMIN: {
    label:          "Admin",
    description:    "Can manage team members, roles, and organisation settings.",
    color:          "bg-blue-50 text-blue-700 border border-blue-200",
    type:           "system",
    canManageUsers: true,
    accessLevel:    "full",
    sensitive:      true,
  },
  ACCOUNTANT: {
    label:          "Accountant",
    description:    "Access to accounting, invoicing, and financial reporting.",
    color:          "bg-emerald-50 text-emerald-700 border border-emerald-200",
    type:           "system",
    canManageUsers: false,
    accessLevel:    "accounting",
    sensitive:      false,
  },
  MEMBER: {
    label:          "Member",
    description:    "Standard access to operational modules.",
    color:          "bg-slate-100 text-slate-600 border border-slate-200",
    type:           "system",
    canManageUsers: false,
    accessLevel:    "operational",
    sensitive:      false,
  },
  VIEWER: {
    label:          "Viewer",
    description:    "Read-only access to all modules.",
    color:          "bg-amber-50 text-amber-700 border border-amber-200",
    type:           "system",
    canManageUsers: false,
    accessLevel:    "readonly",
    sensitive:      false,
  },
};

// ─── Permission groups (static — no API call needed) ───────────────────────────

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id:          "user_management",
    label:       "User Management",
    description: "Invite users, change roles, deactivate members, manage invitations.",
    enforced:    true,
    grantedTo:   ["OWNER", "ADMIN"],
  },
  {
    id:          "accounting",
    label:       "Accounting",
    description: "Journal entries, chart of accounts, period close, financial statements.",
    enforced:    false,
    grantedTo:   ["OWNER", "ADMIN", "ACCOUNTANT"],
  },
  {
    id:          "operations",
    label:       "Operations",
    description: "Invoices, bills, expenses, inventory, customers, vendors.",
    enforced:    false,
    grantedTo:   ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT"],
  },
  {
    id:          "read_only",
    label:       "Read-only Access",
    description: "View all modules without creating or editing records.",
    enforced:    false,
    grantedTo:   ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"],
  },
];

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getRoles(): Promise<RoleWithStats[]> {
  const res = await fetch("/api/settings/roles");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to fetch roles");
  }
  return res.json();
}

export async function getRoleById(roleId: string): Promise<RoleWithStats> {
  const res = await fetch(`/api/settings/roles/${roleId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to fetch role");
  }
  return res.json();
}

// ─── Write (stubs — honest about not being connected) ─────────────────────────

export async function createRole(_payload: { name: string; description: string }): Promise<never> {
  const res = await fetch("/api/settings/roles", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(_payload),
  });
  const data = await res.json();
  throw new Error(data.error ?? "Custom roles are not supported yet.");
}

export async function updateRole(_roleId: string, _payload: unknown): Promise<never> {
  const res = await fetch(`/api/settings/roles/${_roleId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(_payload),
  });
  const data = await res.json();
  throw new Error(data.error ?? "System roles cannot be modified.");
}

export async function deleteRole(_roleId: string): Promise<never> {
  const res = await fetch(`/api/settings/roles/${_roleId}`, { method: "DELETE" });
  const data = await res.json();
  throw new Error(data.error ?? "System roles cannot be deleted.");
}

export async function duplicateRole(_roleId: string): Promise<never> {
  const res = await fetch(`/api/settings/roles/${_roleId}/duplicate`, { method: "POST" });
  const data = await res.json();
  throw new Error(data.error ?? "Custom roles are not supported yet.");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPermissionGroups(): PermissionGroup[] {
  return PERMISSION_GROUPS;
}

export function getRoleUsage(roles: RoleWithStats[]): {
  totalRoles: number;
  systemRoles: number;
  customRoles: number;
  usersAssigned: number;
} {
  return {
    totalRoles:    roles.length,
    systemRoles:   roles.filter((r) => r.type === "system").length,
    customRoles:   roles.filter((r) => r.type === "custom").length,
    usersAssigned: roles.reduce((sum, r) => sum + r.userCount, 0), // active only
  };
}
