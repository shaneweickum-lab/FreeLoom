import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

/** Same reasoning as signin/route.ts -- a server-side proxy so account
 * creation gets an app-specific rate limit on top of Supabase's own
 * generic one, instead of the browser calling signUp() directly with
 * nothing in front of it. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (isRateLimited(`signup:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many attempts -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const emailRedirectTo = typeof body?.emailRedirectTo === "string" ? body.emailRedirectTo : undefined;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ hasSession: !!data.session });
}
