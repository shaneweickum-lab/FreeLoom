import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { heuristicTranslate } from "@/lib/translationEngine";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const description = typeof body?.description === "string" ? body.description : "";
  const hoursSpent = typeof body?.hoursSpent === "number" ? body.hoursSpent : undefined;

  if (!description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  // The knowledge base / heuristic pass always runs first so the subject
  // area, skills, and credit estimate are grounded in a lookup table
  // rather than left to unconstrained model guessing.
  const grounded = heuristicTranslate(description, hoursSpent);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(grounded);
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 400,
      tools: [
        {
          name: "refine_course",
          description: "Return a polished, evaluator-facing course title and rationale.",
          input_schema: {
            type: "object",
            properties: {
              courseTitle: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["courseTitle", "rationale"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "refine_course" },
      messages: [
        {
          role: "user",
          content: `A homeschool parent described this learning activity:\n"${description}"\n\nIt has been grounded to subject area "${grounded.subjectArea}" with skills [${grounded.skills.join(
            ", "
          )}] and ${grounded.creditHours} estimated credit hours. Do not change the subject area, skills, or credit hours. Write a polished, formal course title (like a school transcript would list) and a 1-2 sentence rationale connecting the parent's description to the subject and skills, suitable for a school evaluator or ESA reviewer. Starting point course title: "${grounded.courseTitle}". Starting rationale: "${grounded.rationale}".`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block) => block.type === "tool_use"
    ) as { type: "tool_use"; input: unknown } | undefined;

    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
      return NextResponse.json(grounded);
    }

    const input = toolUse.input as { courseTitle?: string; rationale?: string };
    return NextResponse.json({
      ...grounded,
      courseTitle: input.courseTitle || grounded.courseTitle,
      rationale: input.rationale || grounded.rationale,
      source: "ai-refined",
    });
  } catch (err) {
    console.error("AI refinement failed, falling back to heuristic result", err);
    return NextResponse.json(grounded);
  }
}
