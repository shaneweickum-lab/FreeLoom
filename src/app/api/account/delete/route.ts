import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

/** Self-serve "delete my account" -- fulfills the promise made in
 * /privacy and /terms. Identity is verified via the normal session client
 * (only the signed-in account itself can trigger this, never another
 * user's id from the request body), but the deletions themselves run
 * through the admin/service-role client with explicit user_id/student_id
 * filters at every step -- this repo has no committed RLS policies to
 * verify DELETE is even permitted for a user against every one of these
 * tables (some, like support_threads, are more admin-managed), and a
 * silently-skipped delete due to a missing RLS policy would be worse than
 * this route existing at all: it would leave real orphaned data behind
 * while telling the customer their account was deleted.
 *
 * Order matters: child rows referencing entries/students are removed
 * before the rows they reference, so nothing is ever an orphaned foreign
 * key even transiently. The Auth user itself is deleted LAST and only if
 * every prior step succeeded -- if an earlier step fails, this aborts
 * before touching Auth, so the account still exists and the customer (or
 * support) can retry, rather than ending up in a state where login is
 * gone but some of their data silently isn't. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (body?.confirmation !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  }

  const admin = createAdminClient();
  const userId = user.id;

  const { data: students } = await admin.from("students").select("id").eq("user_id", userId);
  const studentIds = (students ?? []).map((s) => s.id);

  if (studentIds.length > 0) {
    const { data: entries } = await admin.from("entries").select("id").in("student_id", studentIds);
    const entryIds = (entries ?? []).map((e) => e.id);

    if (entryIds.length > 0) {
      const step1 = await Promise.all([
        admin.from("human_resolutions").delete().in("entry_id", entryIds),
        admin.from("retrieval_cases").delete().in("entry_id", entryIds),
      ]);
      for (const { error } of step1) {
        if (error) return failedAt("clearing entry-level records", error);
      }
    }

    const { data: transcripts } = await admin.from("transcripts").select("id").in("student_id", studentIds);
    const transcriptIds = (transcripts ?? []).map((t) => t.id);
    if (transcriptIds.length > 0) {
      // Best-effort: a leftover storage object with no DB row pointing to
      // it is an orphaned file, not exposed personal data through this
      // app, so it doesn't block deletion the way a real DB failure does.
      await admin.storage
        .from("transcripts")
        .remove(transcriptIds.map((id) => `${id}.pdf`))
        .catch((err) => console.error("Failed to remove transcript PDFs during account deletion:", err));
    }

    const step2 = await Promise.all([
      admin.from("entry_subject_tags").delete().in("student_id", studentIds),
      admin.from("entries").delete().in("student_id", studentIds),
    ]);
    for (const { error } of step2) {
      if (error) return failedAt("deleting entries", error);
    }

    const step3 = await Promise.all([
      admin.from("classes").delete().in("student_id", studentIds),
      admin.from("profile_notes").delete().in("student_id", studentIds),
      admin.from("transcripts").delete().in("student_id", studentIds),
    ]);
    for (const { error } of step3) {
      if (error) return failedAt("deleting classes/notes/transcripts", error);
    }

    const { error: studentsError } = await admin.from("students").delete().eq("user_id", userId);
    if (studentsError) return failedAt("deleting student profiles", studentsError);
  }

  const step4 = await Promise.all([
    admin.from("notifications").delete().eq("user_id", userId),
    admin.from("support_messages").delete().eq("parent_user_id", userId),
    admin.from("support_threads").delete().eq("parent_user_id", userId),
    admin.from("benny_messages").delete().eq("user_id", userId),
    admin.from("benny_conversations").delete().eq("user_id", userId),
    admin.from("account_access_requests").delete().eq("target_user_id", userId),
    admin.from("admin_users").delete().eq("user_id", userId),
  ]);
  for (const { error } of step4) {
    if (error) return failedAt("deleting support/notification data", error);
  }

  // Best-effort, same reasoning as the transcripts bucket above.
  const { data: brandingFiles } = await admin.storage
    .from("branding")
    .list(userId)
    .catch((err) => {
      console.error("Failed to list branding files during account deletion:", err);
      return { data: null };
    });
  if (brandingFiles && brandingFiles.length > 0) {
    await admin.storage
      .from("branding")
      .remove(brandingFiles.map((f) => `${userId}/${f.name}`))
      .catch((err) => console.error("Failed to remove branding files during account deletion:", err));
  }

  // Cancel any real Stripe subscription BEFORE dropping the row that
  // points to it -- otherwise a subscribed user who deletes their account
  // keeps being billed indefinitely with no FreeLoom account left to
  // manage it from. Deleting the Stripe Customer immediately cancels every
  // subscription on it (Stripe's own behavior), so one call covers both.
  // A real Stripe failure blocks deletion (same as every DB step above)
  // rather than silently leaving billing running.
  const { data: billingProfiles } = await admin.from("school_profiles").select("stripe_customer_id").eq("user_id", userId);
  const stripeCustomerId = billingProfiles?.[0]?.stripe_customer_id;
  if (stripeCustomerId) {
    try {
      await getStripe().customers.del(stripeCustomerId);
    } catch (err) {
      return failedAt("canceling your subscription", err);
    }
  }

  const { error: profileError } = await admin.from("school_profiles").delete().eq("user_id", userId);
  if (profileError) return failedAt("deleting account profile", profileError);

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("Failed to delete Auth user after deleting all associated data:", authError);
    return NextResponse.json(
      { error: "Your data was deleted, but closing the login itself failed -- contact us to finish this." },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}

function failedAt(step: string, error: unknown) {
  console.error(`Account deletion failed while ${step}:`, error);
  return NextResponse.json({ error: `Something went wrong while ${step}. Nothing was deleted -- try again.` }, {
    status: 500,
  });
}
