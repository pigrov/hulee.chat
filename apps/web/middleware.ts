import { NextResponse, type NextRequest } from "next/server";

import { buildSecurityHeaders } from "./src/security-headers";

export function middleware(_request: NextRequest): NextResponse {
  const response = NextResponse.next();

  for (const header of buildSecurityHeaders()) {
    response.headers.set(header.key, header.value);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
