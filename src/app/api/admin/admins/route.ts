import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // The regular session client can't search auth.users by email -- only the
  // service-role Auth admin API can. A small user base for now means one
  // page covers everyone; revisit with real pagination if that stops holding.
  const adminClient = createAdminClient();
  const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error("admin lookup error:", listError);
    return NextResponse.json({ error: "Couldn't look up that account. Please try again." }, { status: 500 });
  }

  const target = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) {
    return NextResponse.json({ error: "No account found with that email -- they need to sign up first." }, { status: 404 });
  }

  const { error: insertError } = await supabase
    .from("admin_users")
    .insert({ user_id: target.id, email: target.email, approved_by: user.id });

  // A unique-violation just means they're already an admin.
  if (insertError && insertError.code !== "23505") {
    console.error("admin insert error:", insertError);
    return NextResponse.json({ error: "Couldn't add that admin. Please try again." }, { status: 500 });
  }

  // Granting admin access to an account is significant enough that every
  // other admin should find out, not just whoever clicked the button --
  // otherwise a compromised or careless admin action could go unnoticed by
  // the rest of the team indefinitely. Best-effort: a failed notification
  // must not undo the admin grant that already succeeded above.
  if (!insertError) {
    const { data: otherAdmins } = await supabase
      .from("admin_users")
      .select("user_id")
      .neq("user_id", user.id)
      .neq("user_id", target.id);
    if (otherAdmins && otherAdmins.length > 0) {
      const { error: notifyError } = await supabase.from("notifications").insert(
        otherAdmins.map((admin) => ({
          user_id: admin.user_id,
          type: "announcement" as const,
          title: "A new admin was added",
          body: `${target.email} was granted admin access.`,
          link_path: "/admin",
        }))
      );
      if (notifyError) console.error("Failed to notify other admins of a new admin grant:", notifyError);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user || !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }

  const { count } = await supabase.from("admin_users").select("user_id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "Can't remove the last admin." }, { status: 400 });
  }

  const { error: deleteError } = await supabase.from("admin_users").delete().eq("user_id", userId);
  if (deleteError) {
    console.error("admin delete error:", deleteError);
    return NextResponse.json({ error: "Couldn't remove that admin. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
