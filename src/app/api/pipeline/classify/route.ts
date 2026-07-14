import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyWordDump, type ClassifyResult } from "@/lib/pipeline/classify";
import { findRetrievalMatch } from "@/lib/pipeline/retrieve";

// Stage 1 (classify) -> Stage 2 (retrieve), combined into one request since
// Stage 4's confidence check needs both results before it can decide
// whether to flag Stage 5 anyway. No AI call, no external API, anywhere in
// this chain — see src/lib/pipeline/classify.ts and retrieve.ts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawWordDump = typeof body?.raw_word_dump === "string" ? body.raw_word_dump : "";
  const studentId = typeof body?.student_id === "string" ? body.student_id : "";

  if (!rawWordDump.trim() || !studentId) {
    return NextResponse.json({ error: "raw_word_dump and student_id are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // RLS scopes this to the authenticated user's own students; an unowned or
  // missing id resolves to no row, which we treat as not found.
  const { data: student } = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const stage1 = classifyWordDump({
    rawWordDump,
    activityType: typeof body?.activity_type === "string" ? body.activity_type : null,
    sourcePlatform: typeof body?.source_platform === "string" ? body.source_platform : null,
    timeSpentMinutes: typeof body?.time_spent_minutes === "number" ? body.time_spent_minutes : null,
  });

  // A knowledge-base hit is already as specific an answer as v0 gets --
  // only a generic cluster guess (or no match at all) is worth checking
  // this child's own accepted history for something closer.
  const worthRetrying = !stage1.confident || stage1.source === "heuristic_cluster";
  if (worthRetrying) {
    const match = await findRetrievalMatch(supabase, studentId, rawWordDump);
    if (match) {
      const result: ClassifyResult = {
        confident: true,
        subjectArea: match.snapshot.subjectArea,
        courseTitle: match.snapshot.courseTitle,
        creditValue: match.snapshot.creditValue,
        reasoning: match.snapshot.reasoning,
        extractedSlots: stage1.extractedSlots,
        source: "retrieval",
      };
      return NextResponse.json(result);
    }
  }

  return NextResponse.json(stage1);
}
