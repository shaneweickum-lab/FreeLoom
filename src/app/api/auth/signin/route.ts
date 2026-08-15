import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

/** A thin server-side proxy in front of signInWithPassword() -- the login
 * page used to call this directly from the browser, which meant the only
 * throttle on credential-stuffing attempts was Supabase's own generic,
 * project-wide auth rate limit. Running it through this route lets
 * isRateLimited add an app-specific backstop, the same pattern already
 * used for waitlist/checkout/transcript-pdf. Uses the server Supabase
 * client so the resulting session cookie is set directly on this
 * response, same as it would be from a client-side call. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (isRateLimited(`signin:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many sign-in attempts -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
