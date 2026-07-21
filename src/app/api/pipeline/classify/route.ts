import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyWordDump, type ClassifyResult, type TagConfidence } from "@/lib/pipeline/classify";
import { findRetrievalMatch } from "@/lib/pipeline/retrieve";
import { composeFromFragments } from "@/lib/pipeline/compose";
import { callEntryDraftingAdapter } from "@/lib/pipeline/slmDraft";

/** Maps a retrieval match's similarity score to the same confidence
 * vocabulary the rest of the pipeline uses, instead of introducing a raw
 * number the reasoning panel would have to interpret on its own. */
function confidenceFromSimilarity(similarity: number): TagConfidence {
  if (similarity >= 0.9) return "high";
  if (similarity >= 0.8) return "medium";
  return "low";
}

// Stage 1 (classify) -> Stage 2 (retrieve) -> Stage 3 (fragment compose),
// combined into one request since Stage 4's confidence check needs all
// three results before it can decide whether to flag Stage 5 anyway. No AI
// call, no external API, anywhere in this chain.
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

  // A knowledge-base hit on any tag is already as specific an answer as v0
  // gets for that tag; only worth trying Stage 2/3 when every tag so far is
  // a generic cluster guess (or Stage 1 found nothing at all).
  const worthRetrying = !stage1.confident || stage1.tags.every((tag) => tag.source === "heuristic_cluster");
  if (worthRetrying) {
    const match = await findRetrievalMatch(supabase, studentId, rawWordDump);
    if (match) {
      // A retrieval match replaces the whole tag set with what was
      // actually accepted for a similar past word dump -- there's no
      // quoted phrase (it's matched against a *different* entry's text,
      // not a substring of this one).
      const result: ClassifyResult = {
        confident: true,
        tags: match.snapshot.tags.map((tag) => ({
          ...tag,
          confidence: confidenceFromSimilarity(match.similarity),
          quotedPhrase: null,
          source: "retrieval",
        })),
        extractedSlots: stage1.extractedSlots,
      };
      return NextResponse.json(result);
    }

    // Stage 3 needs at least a subject guess to pick fragments for -- a
    // generic cluster tag has one, but a true Stage 1 miss doesn't, so
    // there's nothing for composition to work from either. Runs per tag:
    // only upgrades the canned "matched based on keywords" sentence into
    // an assembled one, doesn't touch the subject/credit/confidence, which
    // are still exactly as sure as the underlying keyword match was.
    if (stage1.confident) {
      const composedTags = await Promise.all(
        stage1.tags.map(async (tag) => {
          if (tag.source !== "heuristic_cluster") return tag;
          const composed = await composeFromFragments(supabase, {
            subjectArea: tag.subjectArea,
            activityType: stage1.extractedSlots.activity_type,
          });
          if (!composed) return tag;
          return { ...tag, courseTitle: composed.courseTitle, reasoning: composed.reasoning, source: "fragment_composition" as const };
        })
      );
      const result: ClassifyResult = { confident: true, tags: composedTags, extractedSlots: stage1.extractedSlots };
      return NextResponse.json(result);
    }
  }

  // Stage 4: everything above missed. Feature-flagged and best-effort --
  // see src/lib/pipeline/slmDraft.ts for why this is a null no-op in every
  // environment today. Never runs on a confident result (both branches
  // above already returned before reaching here in that case).
  const draftCandidate = await callEntryDraftingAdapter({
    rawWordDump,
    extractedSlots: stage1.extractedSlots,
  });
  return NextResponse.json({ ...stage1, draftCandidate });
}
