import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: requests to private areas without a session cookie are sent
 * to sign-in with a real 307 before any rendering starts. This is only a fast
 * path — every page, Server Action and route handler still verifies the session,
 * role and permissions on the server.
 */
const PROTECTED = /^\/(admin|dashboard|coach|pay|join|invoices|community\/new)(\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PROTECTED.test(pathname) && !request.cookies.has("c254_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/coach/:path*", "/pay/:path*", "/join/:path*", "/invoices/:path*", "/community/new"],
};
