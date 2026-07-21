import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Runs daily via Vercel Cron (see vercel.json). No authenticated user in a
 * cron invocation, so this checks the standard Vercel bearer-token
 * convention instead, and uses the service-role client to call
 * cleanup_stale_message_threads() -- a SECURITY DEFINER function granted to
 * service_role only, not authenticated, so it can't be invoked by a regular
 * logged-in user even if they discovered its name. */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("cleanup_stale_message_threads");

  if (error) {
    console.error("cleanup_stale_message_threads error:", error);
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: data });
}
