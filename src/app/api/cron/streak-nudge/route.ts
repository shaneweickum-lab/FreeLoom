import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

/** Same day-window reasoning as duplicateDetection.ts's "same calendar day"
 * choice, just at a longer scale: nudging on day 1-4 of silence would be
 * noisy (most families don't log every single day), and nudging after day
 * 8 is nagging about a streak that's already broken, not saving one. This
 * window is the "still salvageable, worth a reminder" middle -- a starting
 * point, not tuned against real engagement data yet. */
const MIN_DAYS_SINCE_LAST_ENTRY = 5;
const MAX_DAYS_SINCE_LAST_ENTRY = 8;

/** Only nudge students who've actually been logging with some regularity --
 * a brand-new account with one entry ever has no real streak to protect,
 * and nudging it reads as generic nagging rather than a genuine save. */
const MIN_ENTRIES_IN_LAST_30_DAYS = 3;

/** Never send a second nudge inside this window even if the cron runs
 * again before a parent acts on the first one -- once a day is already the
 * ceiling (see vercel.json), this is the actual anti-spam guard. */
const RENUDGE_COOLDOWN_DAYS = 7;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Best-effort -- a failed alert email must never mask the real 500 this
 * route already returns to Vercel Cron's own failure tracking. Mirrors
 * cleanup-threads' own alert helper (see that route for the full
 * reasoning): nobody watches the Cron dashboard on a normal day, so a
 * silent failure here would just mean streak nudges quietly stop. */
async function sendCronFailureAlert(reason: string) {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FreeLoom <onboarding@resend.dev>",
      to,
      subject: "FreeLoom cron job failed: streak-nudge",
      html: `<p>The daily <code>streak-nudge</code> cron job failed.</p><p>${reason}</p>`,
    });
  } catch (err) {
    console.error("Failed to send cron-failure alert email:", err);
  }
}

/** Runs daily via Vercel Cron (see vercel.json). No authenticated user in a
 * cron invocation, so this checks the standard Vercel bearer-token
 * convention instead, and uses the service-role client since it needs to
 * read/write across every family's data, not just one RLS-scoped session. */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();

  const { data: students, error: studentsError } = await adminClient.from("students").select("id, user_id, name");
  if (studentsError) {
    console.error("streak-nudge: failed to load students:", studentsError);
    await sendCronFailureAlert(studentsError.message ?? "Unknown error loading students -- see Vercel logs.");
    return NextResponse.json({ error: "Failed to load students." }, { status: 500 });
  }
  if (!students || students.length === 0) {
    return NextResponse.json({ ok: true, nudged: 0 });
  }

  const studentIds = students.map((s) => s.id);
  const userIds = [...new Set(students.map((s) => s.user_id))];

  // Three flat queries instead of per-student round trips -- everything
  // needed to decide every student's nudge eligibility, grouped in JS below.
  const [{ data: profiles }, { data: recentEntries }, { data: recentNudges }] = await Promise.all([
    adminClient.from("school_profiles").select("user_id, mute_in_app_streak_nudges").in("user_id", userIds),
    adminClient.from("entries").select("student_id, created_at").in("student_id", studentIds).gte("created_at", daysAgoIso(30)),
    adminClient
      .from("notifications")
      .select("related_id")
      .eq("type", "streak_nudge")
      .in("related_id", studentIds)
      .gte("created_at", daysAgoIso(RENUDGE_COOLDOWN_DAYS)),
  ]);

  const mutedUserIds = new Set((profiles ?? []).filter((p) => p.mute_in_app_streak_nudges).map((p) => p.user_id));
  const recentlyNudgedStudentIds = new Set((recentNudges ?? []).map((n) => n.related_id));

  const entryDatesByStudent = new Map<string, string[]>();
  for (const entry of recentEntries ?? []) {
    const dates = entryDatesByStudent.get(entry.student_id) ?? [];
    dates.push(entry.created_at);
    entryDatesByStudent.set(entry.student_id, dates);
  }

  const now = Date.now();
  const toNudge = students.filter((student) => {
    if (mutedUserIds.has(student.user_id)) return false;
    if (recentlyNudgedStudentIds.has(student.id)) return false;

    const entryDates = entryDatesByStudent.get(student.id) ?? [];
    if (entryDates.length < MIN_ENTRIES_IN_LAST_30_DAYS) return false;

    const lastEntryAt = Math.max(...entryDates.map((d) => new Date(d).getTime()));
    const daysSinceLastEntry = (now - lastEntryAt) / (1000 * 60 * 60 * 24);
    return daysSinceLastEntry >= MIN_DAYS_SINCE_LAST_ENTRY && daysSinceLastEntry <= MAX_DAYS_SINCE_LAST_ENTRY;
  });

  if (toNudge.length === 0) {
    return NextResponse.json({ ok: true, nudged: 0 });
  }

  const { error: insertError } = await adminClient.from("notifications").insert(
    toNudge.map((student) => ({
      user_id: student.user_id,
      type: "streak_nudge",
      title: `Keep ${student.name}'s streak going`,
      body: `It's been a few days since ${student.name}'s last logged activity. A quick entry today keeps the habit alive.`,
      link_path: "/log",
      related_id: student.id,
    }))
  );

  if (insertError) {
    console.error("streak-nudge: failed to insert notifications:", insertError);
    await sendCronFailureAlert(insertError.message ?? "Unknown error inserting notifications -- see Vercel logs.");
    return NextResponse.json({ error: "Failed to insert notifications." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nudged: toNudge.length });
}
