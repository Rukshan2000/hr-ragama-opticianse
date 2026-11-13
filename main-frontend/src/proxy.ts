import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE } from "@/lib/session";

// Optimistic page guard only: real authorization is enforced by the backend on every API call.
const GUEST_ONLY = ["/login", "/register", "/forgot-password", "/reset-password"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signedIn = req.cookies.has(REFRESH_COOKIE);
  const guestPage = GUEST_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!signedIn && !guestPage) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (signedIn && guestPage && pathname !== "/reset-password") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
