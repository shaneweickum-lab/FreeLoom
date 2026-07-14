import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findDiscoverySuggestions } from "@/lib/discoveryMap";
import type { SuggestedTrack } from "@/lib/types";

// Keyword-matched against DISCOVERY_MAP, same as the rest of the
// algorithmic-MVP pipeline — no model call, no external API, just a lookup
// table a parent's own words either hit or don't.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const tracks: SuggestedTrack[] = findDiscoverySuggestions(content).map((s) => ({
    subject: s.subjectArea,
    rationale: s.description,
    status: "suggested",
  }));

  return NextResponse.json({ tracks });
}
