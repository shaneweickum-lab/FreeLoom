import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { findDiscoverySuggestions } from "@/lib/discoveryMap";
import { DISCOVERY_SYSTEM_PROMPT, EMIT_TRACKS_TOOL, buildDiscoveryUserMessage } from "@/lib/discoveryPrompt";
import type { SuggestedTrack } from "@/lib/types";

function heuristicTracks(content: string): SuggestedTrack[] {
  return findDiscoverySuggestions(content).map((s) => ({
    subject: s.subjectArea,
    rationale: s.description,
    status: "suggested" as const,
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";
  const gradeLevel = typeof body?.grade_level === "string" ? body.grade_level : null;

  if (!content.trim()) {
    return NextResponse.json({ tracks: [] });
  }

  const heuristic = heuristicTracks(content);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ tracks: heuristic });
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: DISCOVERY_SYSTEM_PROMPT,
      tools: [EMIT_TRACKS_TOOL],
      tool_choice: { type: "tool", name: "emit_tracks" },
      messages: [{ role: "user", content: buildDiscoveryUserMessage(content, gradeLevel) }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use") as
      | { type: "tool_use"; input: unknown }
      | undefined;

    const parsed = toolUse?.input as { tracks?: { subject?: string; rationale?: string }[] } | undefined;
    if (!parsed?.tracks?.length) {
      return NextResponse.json({ tracks: heuristic });
    }

    const tracks: SuggestedTrack[] = parsed.tracks
      .filter((t) => t.subject && t.rationale)
      .map((t) => ({ subject: t.subject!, rationale: t.rationale!, status: "suggested" as const }));

    return NextResponse.json({ tracks: tracks.length ? tracks : heuristic });
  } catch (err) {
    console.error("AI discovery suggestion failed, falling back to heuristic result", err);
    return NextResponse.json({ tracks: heuristic });
  }
}
