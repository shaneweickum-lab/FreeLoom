import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

/** Resolves an email to an existing account's user id -- used by the admin
 * messaging panel to know which parent's thread to open. Same lookup
 * pattern as the "approve as admin" flow in /api/admin/admins. */
export async function POST(req: NextRequest) {
  const { user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error("admin lookup error:", listError);
    return NextResponse.json({ error: "Couldn't look up that account. Please try again." }, { status: 500 });
  }

  const target = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) {
    return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
  }

  return NextResponse.json({ userId: target.id, email: target.email });
}
