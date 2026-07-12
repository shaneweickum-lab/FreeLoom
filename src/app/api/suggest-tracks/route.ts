import { NextRequest, NextResponse } from "next/server";
import { suggestTracks } from "@/lib/translate";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";
  const gradeLevel = typeof body?.grade_level === "string" ? body.grade_level : null;

  const tracks = await suggestTracks(content, gradeLevel);
  return NextResponse.json({ tracks });
}
