import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Route protection for the private "All Rooms" page.
 *
 * `/rooms` lists the signed-in user's own parties and must never be reachable
 * without a session. Everything else (including `/settings`) stays public.
 * This is an optimistic cookie check meant to gate the route early; the page
 * itself also verifies the session client-side before rendering any data.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/rooms", "/rooms/:path*"],
};
