/**
 * Edge-compatible NextAuth config — used ONLY by middleware.
 *
 * No Prisma, no PrismaAdapter, no Node.js-only APIs.
 * The JWT is already signed and stored in the cookie by the full auth.ts config.
 * Middleware just needs to verify + read it, which only requires NEXTAUTH_SECRET.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

const edgeConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  providers: [
    // Provider list must match auth.ts so NextAuth generates compatible tokens.
    // The actual OAuth flow is handled by auth.ts — this is read-only for middleware.
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID     ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    // Read org fields from the token (written by auth-config.ts on sign-in).
    // Never touch the database here.
    session({ session, token }) {
      if (token && session.user) {
        session.user.id               = token.id               as string;
        session.user.organizationId   = token.organizationId   as string | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.user.role             = token.role             as any;
        session.user.organizationName = token.organizationName as string | null;
      }
      return session;
    },
  },
};

export const { auth } = NextAuth(edgeConfig);
