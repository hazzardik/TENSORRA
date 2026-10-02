import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const protectedPage = path === "/app" || path.startsWith("/app/");
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // API handlers must return their own JSON 401 responses. Redirecting /api/*
  // to /login makes fetch() receive HTML with a 200 after redirect, which can
  // surface as JSON parse errors in the chat/file upload client.
  if (!claims && protectedPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (claims && path === "/login") {
    const url = request.nextUrl.clone(); url.pathname = "/app";
    return NextResponse.redirect(url);
  }
  return response;
}
