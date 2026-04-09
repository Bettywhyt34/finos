import type { NextAuthConfig } from "next-auth";
import { prisma } from "@/lib/prisma";

/**
 * Custom JWT hook — injects tenant_id, role, org_id into every token.
 * Called on sign-in and on every session refresh (trigger === "update").
 *
 * Separation of concerns: this file owns the token/session shape;
 * lib/auth.ts owns the providers and adapter.
 */
export const authCallbacks: NextAuthConfig["callbacks"] = {
  /**
   * JWT callback: runs when a token is created or refreshed.
   * With database strategy this still fires for the initial OAuth exchange.
   * We store org data in the token so the session callback is pure read.
   */
  async jwt({ token, user, trigger }) {
    // Initial sign-in: `user` is the DB record
    if (user?.id) {
      token.id = user.id;

      const membership = await prisma.organizationMembership.findFirst({
        where: { userId: user.id },
        include: {
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      token.organizationId = membership?.organizationId ?? null;
      token.role = membership?.role ?? null;
      token.organizationName = membership?.organization?.name ?? null;
    }

    // Re-hydrate on `update()` call (e.g. after org creation / switching)
    if (trigger === "update" && token.id) {
      const membership = await prisma.organizationMembership.findFirst({
        where: { userId: token.id as string },
        include: {
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      token.organizationId = membership?.organizationId ?? null;
      token.role = membership?.role ?? null;
      token.organizationName = membership?.organization?.name ?? null;
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
      session.user.organizationId = token.organizationId as string | null;
      session.user.role = token.role as import("@prisma/client").UserRole | null;
      session.user.organizationName = token.organizationName as string | null;
    }
    return session;
  },
};
