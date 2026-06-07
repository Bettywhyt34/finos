import type { NextAuthConfig } from "next-auth";
import { prisma } from "@/lib/prisma";

/**
 * Custom JWT hook — injects tenant_id, role, tenant_name into every token.
 * Called on sign-in and on every session refresh (trigger === "update").
 *
 * Separation of concerns: this file owns the token/session shape;
 * lib/auth.ts owns the providers and adapter.
 */
export const authCallbacks: NextAuthConfig["callbacks"] = {
  /**
   * JWT callback: runs when a token is created or refreshed.
   * With database strategy this still fires for the initial OAuth exchange.
   * We store tenant data in the token so the session callback is pure read.
   */
  async jwt({ token, user, trigger }) {
    // Initial sign-in: `user` is the DB record
    if (user?.id) {
      token.id = user.id;

      // ── Auto-accept pending invitations ──────────────────────────────────
      // On every sign-in, find non-expired PENDING invitations for this email
      // and create TenantMembership records atomically. If a concurrent request
      // already created the membership (P2002), we still mark the invitation
      // ACCEPTED so it doesn't stay in the pending list.
      //
      // This block is wrapped in try/catch: a DB error must never prevent sign-in.
      const userEmail = user.email ?? (token.email as string | undefined);
      if (userEmail) {
        try {
          const pendingInvitations = await prisma.tenantInvitation.findMany({
            where: {
              email:     userEmail,
              status:    "PENDING",
              expiresAt: { gt: new Date() },
            },
          });

          for (const invitation of pendingInvitations) {
            try {
              // Atomic: create membership + accept invitation in one transaction.
              // If the membership already exists (P2002 unique violation), fall through
              // to the catch block and just mark the invitation accepted.
              await prisma.$transaction([
                prisma.tenantMembership.create({
                  data: {
                    tenantId: invitation.tenantId,
                    userId:   user.id,
                    role:     invitation.role,
                    status:   "ACTIVE",
                  },
                }),
                prisma.tenantInvitation.update({
                  where: { id: invitation.id },
                  data:  { status: "ACCEPTED" },
                }),
              ]);
            } catch (txErr: unknown) {
              // P2002 = unique constraint violation (membership already exists)
              const code = (txErr as { code?: string })?.code;
              if (code === "P2002") {
                // Membership already exists — just accept the invitation
                await prisma.tenantInvitation.update({
                  where: { id: invitation.id },
                  data:  { status: "ACCEPTED" },
                }).catch(() => { /* best-effort */ });
              } else {
                console.error("[auth] invitation auto-accept transaction failed:", txErr);
              }
            }
          }
        } catch (err) {
          // Never let invitation processing break the sign-in flow
          console.error("[auth] invitation auto-accept query failed:", err);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const membership = await prisma.tenantMembership.findFirst({
        where:   { userId: user.id, status: "ACTIVE" },
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });

      token.tenantId = membership?.tenantId ?? null;
      token.role = membership?.role ?? null;
      token.tenantName = membership?.tenant?.name ?? null;
    }

    // Re-hydrate on `update()` call (e.g. after tenant creation / switching)
    if (trigger === "update" && token.id) {
      const membership = await prisma.tenantMembership.findFirst({
        where:   { userId: token.id as string, status: "ACTIVE" },
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });

      token.tenantId = membership?.tenantId ?? null;
      token.role = membership?.role ?? null;
      token.tenantName = membership?.tenant?.name ?? null;
    }

    return token;
  },

  /**
   * Session callback: shapes what the client receives from useSession().
   * Reads from token (JWT strategy). Never fetches the DB here — keep it fast.
   */
  async session({ session, token }) {
    if (token && session.user) {
      session.user.id = token.id as string;
      session.user.tenantId = token.tenantId as string | null;
      session.user.role = token.role as import("@prisma/client").UserRole | null;
      session.user.tenantName = token.tenantName as string | null;
    }
    return session;
  },
};
