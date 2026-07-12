import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { heuristicTranslate } from "@/lib/translationEngine";
import { EMIT_COURSE_TOOL, TRANSLATION_SYSTEM_PROMPT, buildTranslationUserMessage } from "@/lib/translationPrompt";
import type { TranslateLogRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw_description = typeof body?.raw_description === "string" ? body.raw_description : "";

  if (!raw_description.trim()) {
    return NextResponse.json({ error: "raw_description is required" }, { status: 400 });
  }

  const input: TranslateLogRequest = {
    raw_description,
    activity_type: body?.activity_type || "other",
    source_platform: body?.source_platform || null,
    time_spent_minutes: typeof body?.time_spent_minutes === "number" ? body.time_spent_minutes : null,
    grade_level: body?.grade_level || null,
  };

  const groundingHint = heuristicTranslate(input.raw_description, input.time_spent_minutes);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(groundingHint);
  }

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

    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
      return NextResponse.json(groundingHint);
    }

    const parsed = toolUse.input as {
      course_title?: string;
      subject_area?: string;
      credit_hours?: number;
      rationale?: string;
    };

    if (!parsed.course_title || !parsed.subject_area || typeof parsed.credit_hours !== "number" || !parsed.rationale) {
      return NextResponse.json(groundingHint);
    }

    return NextResponse.json({
      course_title: parsed.course_title,
      subject_area: parsed.subject_area,
      credit_hours: parsed.credit_hours,
      rationale: parsed.rationale,
      source: "ai",
    });
  } catch (err) {
    console.error("AI translation failed, falling back to heuristic result", err);
    return NextResponse.json(groundingHint);
  }
}
