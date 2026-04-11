import { auth } from "@/lib/auth-edge";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public routes — no auth required
const PUBLIC_ROUTES = ["/login", "/signup", "/register", "/api/auth"];

export default auth(function middleware(req) {
  const { nextUrl, auth: session } = req as NextRequest & { auth: typeof req.auth };
  const isPublic = PUBLIC_ROUTES.some((r) => nextUrl.pathname.startsWith(r));

  if (!session && !isPublic) {
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
