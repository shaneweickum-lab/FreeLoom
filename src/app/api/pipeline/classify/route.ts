import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyWordDump } from "@/lib/pipeline/classify";

// Stage 1 (classify) + v0 Stage 3 (template draft) — see src/lib/pipeline/classify.ts
// for the actual logic. This route is just an auth-gated wrapper around a
// pure function; no AI call, no external API, happens anywhere in here.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawWordDump = typeof body?.raw_word_dump === "string" ? body.raw_word_dump : "";

  if (!rawWordDump.trim()) {
    return NextResponse.json({ error: "raw_word_dump is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const result = classifyWordDump({
    rawWordDump,
    activityType: typeof body?.activity_type === "string" ? body.activity_type : null,
    sourcePlatform: typeof body?.source_platform === "string" ? body.source_platform : null,
    timeSpentMinutes: typeof body?.time_spent_minutes === "number" ? body.time_spent_minutes : null,
  });

  return NextResponse.json(result);
}
