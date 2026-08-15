import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Accepts whatever pending household invite matches the signed-in user's
 * own auth email -- there's no token in the URL to check against, the
 * match is entirely "does a pending row's invited_email equal my own
 * verified sign-in email," same trust boundary Supabase auth itself
 * already establishes for that email. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: invite } = await supabase
    .from("household_members")
    .select("id")
    .eq("invited_email", user.email.toLowerCase())
    .eq("status", "pending")
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "No pending invite found for this email." }, { status: 404 });
  }

  const { error } = await supabase
    .from("household_members")
    .update({ member_user_id: user.id, status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  if (error) {
    console.error("Failed to accept household invite:", error);
    return NextResponse.json({ error: "Couldn't accept that invite -- try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
