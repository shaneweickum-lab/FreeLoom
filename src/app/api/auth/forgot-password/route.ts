import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

/** Same reasoning as signin/route.ts, but the tightest limit of the three --
 * this is the endpoint most valuable to an email-enumeration/spam attacker,
 * since a real email goes out per successful call. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (isRateLimited(`forgot-password:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many attempts -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const redirectTo = typeof body?.redirectTo === "string" ? body.redirectTo : undefined;
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
