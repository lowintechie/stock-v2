import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Block direct requests to the Convex token endpoint that have no
  // Origin or Referer header — these are bots/scrapers, not browser
  // requests from your app.
  if (pathname.startsWith("/api/auth/convex/token")) {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (!origin && !referer) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/:path*"],
};
