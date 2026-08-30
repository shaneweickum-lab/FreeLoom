/**
 * Stage 4 drafting via the client-side WebLLM "pipeline" engine -- the
 * live replacement for slmDraft.ts's (now dormant) callEntryDraftingAdapter().
 * Same downstream contract, same guardrails (validateDraftCandidate,
 * agreesWithClassicalClassifier), only the generator changed: instead of
 * this project's own hand-trained BitNet model running in-process on the
 * server, this calls Llama 3.2 1B running in the browser via WebGPU.
 *
 * Client-only by necessity -- there is no server-side equivalent of this
 * function. /api/pipeline/classify/route.ts stops at Stage 1-3 and never
 * attempts drafting itself; the caller (src/app/(app)/log/page.tsx) runs
 * this in the browser only after the server route comes back
 * `confident: false`.
 */

import type { InitProgressCallback } from "@mlc-ai/web-llm";
import { getBennyEngine } from "@/lib/benny/webllm/engine";
import { LLAMA_3_2_1B } from "@/lib/benny/webllm/models";
import { agreesWithClassicalClassifier } from "@/lib/pipeline/subjectClassifier";
import { validateDraftCandidate, type DraftCandidate } from "@/lib/pipeline/draftValidation";

/** Llama 3.2 1B is a general-purpose instruction-following model, not a
 * task-specific fine-tune the way the old BitNet adapter was -- this
 * system prompt is what actually constrains it to the same four-line
 * format callEntryDraftingAdapter()'s old generator produced, so the
 * parsing/validation below can stay identical either way. */
const SYSTEM_PROMPT = `You help a homeschool parent turn a short, informal description of what their child did into one structured class entry. Reply with EXACTLY these four lines, in this order, nothing before or after them, no markdown formatting:
course_title: <a specific, real-sounding course name, not generic like "Learning Skills">
subject_area: <one clear, standard school subject>
credit_value: <a small conservative decimal number, typically 0.05-0.5, reflecting a single logged activity, not a full course>
rationale: <1-2 honest, specific sentences connecting the actual activity described to the subject -- no generic filler>`;

// Same shape slmDraft.ts's old ENTRY_DRAFT_PATTERN parsed, so a change to
// either generator's prompt doesn't also require a second parser to keep
// in sync -- both ultimately produce this same four-line format.
const DRAFT_PATTERN =
  /course_title:\s*([\s\S]*?)\nsubject_area:\s*([\s\S]*?)\ncredit_value:\s*([\s\S]*?)\nrationale:\s*([\s\S]*)/;

function parseDraftCompletion(text: string): DraftCandidate | null {
  const match = DRAFT_PATTERN.exec(text);
  if (!match) return null;
  const [, courseTitle, subjectArea, creditValueRaw, rationale] = match;

  const creditValue = Number(creditValueRaw.trim());
  if (Number.isNaN(creditValue)) return null;

  return {
    subjectArea: subjectArea.trim(),
    courseTitle: courseTitle.trim(),
    creditValue,
    rationale: rationale.trim(),
  };
}

/**
 * Runs Stage 4 drafting client-side. Best-effort, same as the old
 * generator: an unavailable engine (no WebGPU, still downloading, load
 * failed), an unparseable completion, or a candidate that fails either
 * guardrail all resolve to null -- identical to Stage 1-3 finding
 * nothing, so the caller falls through to today's blank Stage 5 form
 * either way, never a broken UI over any of this being unavailable.
 *
 * `onProgress` only ever fires while the engine is still loading (a
 * first-ever call on a fresh browser can mean a real, multi-hundred-MB
 * download) -- callers should surface it as loading/status text rather
 * than leaving a parent staring at an unexplained pause, since this can
 * take meaningfully longer than a normal network request.
 */
export async function draftEntryClientSide(
  rawWordDump: string,
  onProgress?: InitProgressCallback
): Promise<DraftCandidate | null> {
  const result = await getBennyEngine("pipeline", LLAMA_3_2_1B, onProgress);
  if (!result.engine) return null;

  try {
    const completion = await result.engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `activity: ${rawWordDump}` },
      ],
      temperature: 0,
    });
    const text = completion.choices[0]?.message?.content ?? "";

    const candidate = parseDraftCompletion(text);
    if (!candidate || !validateDraftCandidate(candidate)) return null;
    // Section 7's second safeguard: an independent classical signal has to
    // agree the subject is at least plausible before this draft is trusted
    // -- a substantial disagreement flags for human review the same way a
    // shape-validation failure does, rather than trusting the model silently.
    if (!agreesWithClassicalClassifier(candidate.subjectArea, rawWordDump)) return null;
    return candidate;
  } catch (err) {
    console.error("Client-side entry drafting failed:", err);
    return null;
  }
}
