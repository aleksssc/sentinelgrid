import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  /* =========================================
     PUBLIC ROUTES
  ========================================= */

  const publicRoutes = [
    "/",
    "/features",
    "/pricing",
    "/security",
    "/about",
    "/contact",
  ];

  const pathname = request.nextUrl.pathname;

  const isPublicRoute = publicRoutes.some(
    (route) =>
      pathname === route ||
      (route !== "/" && pathname.startsWith(`${route}/`))
  );

  const isAuthRoute = pathname.startsWith("/auth");

  /* =========================================
     PROTECTED ROUTES
  ========================================= */

  if (!user && !isPublicRoute && !isAuthRoute) {
    const url = request.nextUrl.clone();

    url.pathname = "/auth/login";

    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}