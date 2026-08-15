import { renderToBuffer } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHouseholdOwnerId } from "@/lib/household";
import { PortfolioDocument, type PortfolioPdfClass } from "@/lib/PortfolioDocument";

/** Builds a portfolio PDF from a parent-chosen subset of a student's
 * accepted entries -- unlike /api/transcript-pdf (a fixed, already-
 * generated document looked up by id), this renders on demand from
 * whatever entryIds the parent just picked in the download modal, so
 * there's no separate "generate" step or stored record for this export.
 *
 * Runs through the session-scoped client (not the admin client), so RLS is
 * a second real backstop over the explicit student_id/entryIds filters
 * below -- even if a filter here were ever wrong, RLS still can't return
 * another account's student or entries through this route. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const entryIds = Array.isArray(body?.entryIds) ? body.entryIds.filter((id: unknown) => typeof id === "string") : [];
  if (!studentId || entryIds.length === 0) {
    return NextResponse.json({ error: "studentId and at least one entryId are required." }, { status: 400 });
  }

  // Resolved to the household's owner id -- an accepted guardian's own
  // auth id was never the owning students.user_id these rows are keyed by
  // (see resolveHouseholdOwnerId()'s own doc comment).
  const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
  if (!ownerId) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id, name")
    .eq("id", studentId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("school_profiles")
    .select("school_name, logo_url, accent_color")
    .eq("user_id", ownerId)
    .maybeSingle();

  // Only accepted entries belonging to this specific student can ever end
  // up in the PDF -- an id for a draft, a needs-review entry, or another
  // student's entry entirely (however it got into the request body)
  // silently drops out here rather than being trusted at face value.
  const { data: entries } = await supabase
    .from("entries")
    .select("*, classes(id, title, subject_area)")
    .in("id", entryIds)
    .eq("student_id", studentId)
    .eq("status", "accepted");

  const classesById = new Map<string, PortfolioPdfClass>();
  for (const entry of entries ?? []) {
    const cls = entry.classes as { id: string; title: string; subject_area: string } | null;
    if (!cls) continue;
    if (!classesById.has(cls.id)) {
      classesById.set(cls.id, { id: cls.id, title: cls.title, subjectArea: cls.subject_area, entries: [] });
    }
    classesById.get(cls.id)!.entries.push({
      id: entry.id,
      createdAt: entry.created_at,
      rawWordDump: entry.raw_word_dump,
      finalDescription: entry.final_description,
      finalReasoning: entry.final_reasoning,
      creditValue: entry.credit_value,
    });
  }
  // Oldest-first within each class, and classes in the order their first
  // selected entry appears -- matches the portfolio page's own ordering
  // rather than an arbitrary DB-return order.
  const classes = Array.from(classesById.values()).map((cls) => ({
    ...cls,
    entries: cls.entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const buffer = await renderToBuffer(
    <PortfolioDocument
      studentName={student.name}
      generatedAt={new Date().toISOString()}
      classes={classes}
      school={{
        schoolName: profile?.school_name ?? null,
        logoUrl: profile?.logo_url ?? null,
        accentColor: profile?.accent_color ?? null,
      }}
    />
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${student.name.replace(/\s+/g, "_").toLowerCase()}_portfolio.pdf"`,
    },
  });
}
