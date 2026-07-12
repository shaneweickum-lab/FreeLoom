import { NextRequest, NextResponse } from "next/server";
import { translateLearningLog } from "@/lib/translate";
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

  const result = await translateLearningLog(input);
  return NextResponse.json(result);
}
