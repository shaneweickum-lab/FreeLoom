import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isInactive } from "@/lib/inactivityTimeout";

const LAST_ACTIVE_COOKIE = "fl_last_active";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/profile",
  "/log",
  "/transcript",
  "/portfolio",
  "/students",
  "/admin",
  "/messages",
  "/notifications",
  "/settings",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
        },
      },
    }
  );

  // IMPORTANT: getClaims() validates the JWT signature; never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  // "Keep me signed in" (src/lib/authSession.ts) is a client-side UX
  // preference layered on top of Supabase's own long-lived cookie -- this
  // is the actual security backstop, enforced here server-side regardless
  // of anything client-side storage says. Only checked/refreshed on
  // protected routes: a logged-in parent idly browsing the public marketing
  // pages shouldn't get bounced, but nothing there depends on the session
  // being fresh either.
  if (user && isProtected) {
    const lastActive = request.cookies.get(LAST_ACTIVE_COOKIE)?.value;
    if (isInactive(lastActive, Date.now())) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      url.searchParams.set("reason", "inactivity");
      const response = NextResponse.redirect(url);
      response.cookies.delete(LAST_ACTIVE_COOKIE);
      return response;
    }
    supabaseResponse.cookies.set(LAST_ACTIVE_COOKIE, new Date().toISOString(), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // The cookie's own lifetime is intentionally long -- isInactive()
      // above (a 72h sliding window checked on every request) is what
      // actually enforces the timeout, not this expiry.
      maxAge: 60 * 60 * 24 * 400,
    });
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
