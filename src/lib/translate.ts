import Anthropic from "@anthropic-ai/sdk";
import { heuristicTranslate } from "@/lib/translationEngine";
import { EMIT_COURSE_TOOL, TRANSLATION_SYSTEM_PROMPT, buildTranslationUserMessage } from "@/lib/translationPrompt";
import type { TranslateLogRequest, TranslateLogResponse } from "@/lib/types";

// Stage 1-3 of the algorithmic-MVP pipeline (src/lib/pipeline) replace this
// Claude call entirely once they land — this function stays only as a
// bridge until that build-out phase, so /log doesn't break in the meantime.
export async function translateLearningLog(input: TranslateLogRequest): Promise<TranslateLogResponse> {
  const groundingHint = heuristicTranslate(input.raw_description, input.time_spent_minutes);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return groundingHint;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: TRANSLATION_SYSTEM_PROMPT,
      tools: [EMIT_COURSE_TOOL],
      tool_choice: { type: "tool", name: "emit_course" },
      messages: [{ role: "user", content: buildTranslationUserMessage(input, groundingHint) }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use") as
      | { type: "tool_use"; input: unknown }
      | undefined;

    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) return groundingHint;

    const parsed = toolUse.input as {
      course_title?: string;
      subject_area?: string;
      credit_hours?: number;
      rationale?: string;
    };

    if (!parsed.course_title || !parsed.subject_area || typeof parsed.credit_hours !== "number" || !parsed.rationale) {
      return groundingHint;
    }

    return {
      course_title: parsed.course_title,
      subject_area: parsed.subject_area,
      credit_hours: parsed.credit_hours,
      rationale: parsed.rationale,
      source: "ai",
    };
  } catch (err) {
    console.error("AI translation failed, falling back to heuristic result", err);
    return groundingHint;
  }
}
