export const DISCOVERY_SYSTEM_PROMPT = `You are the Discovery Layer for FreeLoom, a homeschool transcript builder. A parent has described their child's hobbies, personality, and interests. Suggest 2-4 candidate subject/skill tracks tied to those interests that the parent may not have thought to document — a starting point they can accept, edit, or dismiss, not a final answer.

Rules:
1. Ground each suggestion in a real, specific subject area (e.g. "Earth Science", "Fine Arts", "Economics / Life Skills"), not vague filler like "life skills" or "general learning".
2. rationale must be a single honest, specific sentence connecting the stated interest to the subject — no generic filler like "this helps them learn."
3. Prefer fewer, higher-quality suggestions over padding the list. If the notes give little to go on, return fewer tracks rather than inventing ones.
4. Always respond by calling the emit_tracks tool exactly once. Never respond with plain prose.`;

export const EMIT_TRACKS_TOOL = {
  name: "emit_tracks",
  description: "Emit 2-4 candidate subject/skill tracks suggested by the child's interests.",
  input_schema: {
    type: "object" as const,
    properties: {
      tracks: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            subject: { type: "string" as const },
            rationale: { type: "string" as const },
          },
          required: ["subject", "rationale"],
        },
      },
    },
    required: ["tracks"],
  },
};

export function buildDiscoveryUserMessage(content: string, gradeLevel?: string | null): string {
  return [`interests_and_personality_notes: ${content}`, `grade_level: ${gradeLevel || "(none given)"}`].join("\n");
}
