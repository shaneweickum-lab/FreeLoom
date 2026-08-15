import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Owner-only: revokes a guardian's access (pending or accepted). Sets
 * status to 'revoked' rather than deleting the row outright, so a later
 * re-invite of the same email can't collide with (or silently resurrect)
 * this history -- see the invite route's upsert on (owner_user_id,
 * invited_email). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("household_members")
    .update({ status: "revoked" })
    .eq("id", memberId)
    .eq("owner_user_id", user.id);

  if (error) {
    console.error("Failed to remove household member:", error);
    return NextResponse.json({ error: "Couldn't remove that guardian -- try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
