/**
 * Server-only auth guard helpers.
 * Replaces scattered (session.user as any).role casts across API routes.
 */
import "server-only";
import { NextResponse } from "next/server";
import { auth }        from "@/lib/auth";
import type { UserRole } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthContext = {
  userId:   string;
  tenantId: string;
  role:     UserRole;
  email:    string | null | undefined;
};

type AuthResult =
  | { ctx: AuthContext; response: null }
  | { ctx: null; response: NextResponse };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns AuthContext from JWT-backed session (no DB call). Returns null if unauthenticated. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) return null;
  return {
    userId:   session.user.id,
    tenantId: session.user.tenantId,
    role:     session.user.role,
    email:    session.user.email,
  };
}

/** Returns ctx or a 401 NextResponse. */
export async function requireAuth(): Promise<AuthResult> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return { ctx: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ctx, response: null };
}

/**
 * Returns ctx if role is in allowedRoles, otherwise a 401 or 403 NextResponse.
 * 401 = unauthenticated, 403 = authenticated but wrong role.
 */
export async function requireMutationRole(allowedRoles: UserRole[]): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) {
    return { ctx: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.user.role || !allowedRoles.includes(session.user.role)) {
    return { ctx: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return {
    ctx: {
      userId:   session.user.id,
      tenantId: session.user.tenantId,
      role:     session.user.role,
      email:    session.user.email,
    },
    response: null,
  };
}

// ─── Convenience predicates ───────────────────────────────────────────────────

export function canMutateSettings(role: UserRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canViewSettings(_role: UserRole): boolean {
  return true;
}
