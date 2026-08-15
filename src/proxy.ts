import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A same-origin check for state-changing API requests, on top of (not
 * instead of) @supabase/ssr's SameSite=Lax cookie default -- that default
 * already blocks the auth cookie on a genuine cross-site POST, but relying
 * on a cookie attribute alone means one browser quirk or a future change
 * to that default is the only thing standing between a forged
 * cross-origin form post and this app's session. Deliberately fails open
 * when Origin is absent (webhooks, curl, any legitimate non-browser
 * caller never send a browser-style Origin header) -- a real cross-site
 * browser request reliably does send one, so this only ever blocks a
 * mismatch it can actually see, never a caller it can't identify.
 * /api/webhooks/* is exempt outright: those are inherently cross-origin
 * by design (Stripe calling in) and already verified by signature. */
function isForgedCrossOriginRequest(request: NextRequest): boolean {
  if (!MUTATING_METHODS.has(request.method)) return false;
  // Scoped to this app's own API routes -- Next.js Server Actions (POSTs
  // to a page route) have their own separate same-origin enforcement
  // built in, and this app doesn't use POST to a plain page route for
  // anything of its own.
  if (!request.nextUrl.pathname.startsWith("/api/")) return false;
  if (request.nextUrl.pathname.startsWith("/api/webhooks/")) return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin !== request.nextUrl.origin;
}

export async function proxy(request: NextRequest) {
  if (isForgedCrossOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
