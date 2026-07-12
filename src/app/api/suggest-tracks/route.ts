import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestTracks } from "@/lib/translate";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";
  const gradeLevel = typeof body?.grade_level === "string" ? body.grade_level : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const tracks = await suggestTracks(content, gradeLevel, { supabase, userId: user.id });
  return NextResponse.json({ tracks });
}
