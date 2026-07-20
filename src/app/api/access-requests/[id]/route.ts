import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ACTION_TO_STATUS = {
  approve: "approved",
  deny: "denied",
  revoke: "revoked",
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const newStatus = ACTION_TO_STATUS[action as keyof typeof ACTION_TO_STATUS];
  if (!newStatus) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  // Real enforcement is RLS (target_user_id = auth.uid(), so only the parent
  // this request is about can ever update it -- the requesting admin cannot
  // self-approve) plus the enforce_access_request_transition trigger, which
  // rejects any transition other than pending->approved/denied or
  // approved->revoked and computes expires_at server-side regardless of
  // what the client sends. This route just gives a clear error message
  // instead of a silently-empty update.
  const { data, error } = await supabase
    .from("account_access_requests")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("target_user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("access request update error:", error);
    return NextResponse.json({ error: "Couldn't update that request. It may already be resolved." }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const { error: notifyError } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("related_id", id)
    .eq("type", "access_request");
  if (notifyError) console.error("notification mark-read error:", notifyError);

  return NextResponse.json({ ok: true });
}
