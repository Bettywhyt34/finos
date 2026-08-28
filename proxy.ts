import { auth } from "@/lib/auth-edge";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public routes — no auth required
const PUBLIC_PAGES = new Set(["/login", "/signup", "/register", "/accept-invite"]);

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PAGES.has(pathname) || pathname.startsWith("/api/auth/");
}

export default auth(function proxy(req) {
  const { nextUrl, auth: session } = req as NextRequest & { auth: typeof req.auth };
  const isPublic = isPublicRoute(nextUrl.pathname);

  if (!session && !isPublic) {
    if (nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Redirect authenticated users without a tenant to onboarding
  if (session?.user && !session.user.tenantId && !isPublic) {
    if (!nextUrl.pathname.startsWith("/register")) {
      return NextResponse.redirect(new URL("/register", nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
