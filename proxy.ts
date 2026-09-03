import { updateSession } from "@/lib/supabase/proxy";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

export async function proxy(
  request: NextRequest
) {
  const pathname =
    request.nextUrl.pathname;

  /* =========================
     SENTINELGRID AGENT API

     Estas rotas não usam
     sessão Supabase do browser.
     Autenticam com tokens próprios.
  ========================= */

  if (
    pathname ===
      "/api/agent/enroll" ||
    pathname ===
      "/api/agent/heartbeat" ||
    pathname ===
      "/api/agent/download"
  ) {
    return NextResponse.next();
  }

  /* =========================
     AGENT DOWNLOAD FILES

     O MSI precisa de ser
     acessível diretamente pela
     API de download sem passar
     pelo auth proxy.
  ========================= */

  if (
    pathname.startsWith(
      "/downloads/"
    )
  ) {
    return NextResponse.next();
  }

  /* =========================
     NORMAL APP AUTH
  ========================= */

  return await updateSession(
    request
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static
     * - _next/image
     * - favicon.ico
     * - image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};