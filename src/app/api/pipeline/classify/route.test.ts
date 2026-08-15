import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// classifyWordDump itself is NOT mocked -- it's pure, already has its own
// thorough test suite, and using the real thing here is what makes this a
// genuine integration test of the route's DB-dependent orchestration
// (auth, student ownership, degrade-gracefully fallbacks, Stage 2/3/4
// branching) rather than just re-testing classify.ts a second time.

let getUserResult: { data: { user: { id: string } | null } };
let studentRow: { data: unknown };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => studentRow),
          })),
        })),
      })),
    })),
  })),
}));

const getKnowledgeBaseMock = vi.fn();
vi.mock("@/lib/knowledgeBase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledgeBase")>();
  return { ...actual, getKnowledgeBase: (...args: unknown[]) => getKnowledgeBaseMock(...args) };
});

import { KNOWLEDGE_BASE } from "@/lib/knowledgeBase";

const getResearchCitationsMock = vi.fn<(supabase: unknown) => Promise<unknown[]>>(async () => []);
vi.mock("@/lib/research/matchCitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research/matchCitations")>();
  return { ...actual, getResearchCitations: (supabase: unknown) => getResearchCitationsMock(supabase) };
});

const findRetrievalMatchMock = vi.fn<(supabase: unknown, studentId: string, rawWordDump: string) => Promise<unknown>>(
  async () => null
);
vi.mock("@/lib/pipeline/retrieve", () => ({
  findRetrievalMatch: (supabase: unknown, studentId: string, rawWordDump: string) =>
    findRetrievalMatchMock(supabase, studentId, rawWordDump),
}));

const composeFromFragmentsMock = vi.fn<(supabase: unknown, input: unknown) => Promise<unknown>>(async () => null);
vi.mock("@/lib/pipeline/compose", () => ({
  composeFromFragments: (supabase: unknown, input: unknown) => composeFromFragmentsMock(supabase, input),
}));

const callEntryDraftingAdapterMock = vi.fn<(input: unknown) => Promise<unknown>>(async () => null);
vi.mock("@/lib/pipeline/slmDraft", () => ({
  callEntryDraftingAdapter: (input: unknown) => callEntryDraftingAdapterMock(input),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1" };
const STUDENT_ID = "student-1";

describe("POST /api/pipeline/classify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    studentRow = { data: { id: STUDENT_ID } };
    getKnowledgeBaseMock.mockResolvedValue(KNOWLEDGE_BASE);
    getResearchCitationsMock.mockResolvedValue([]);
    findRetrievalMatchMock.mockResolvedValue(null);
    composeFromFragmentsMock.mockResolvedValue(null);
    callEntryDraftingAdapterMock.mockResolvedValue(null);
  });

  it("400s when raw_word_dump is missing", async () => {
    const res = await POST(makeRequest({ student_id: STUDENT_ID }));
    expect(res.status).toBe(400);
  });

  it("400s when student_id is missing", async () => {
    const res = await POST(makeRequest({ raw_word_dump: "Played chess" }));
    expect(res.status).toBe(400);
  });

  it("401s when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ raw_word_dump: "Played chess", student_id: STUDENT_ID }));
    expect(res.status).toBe(401);
  });

  it("404s when the student doesn't belong to (or isn't found for) the signed-in user", async () => {
    studentRow = { data: null };
    const res = await POST(makeRequest({ raw_word_dump: "Played chess", student_id: STUDENT_ID }));
    expect(res.status).toBe(404);
  });

  it("returns a confident knowledge-base match without touching Stage 2/3/4", async () => {
    const res = await POST(makeRequest({ raw_word_dump: "Played chess with dad", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(true);
    expect(body.tags[0].source).toBe("knowledge_base");
    expect(findRetrievalMatchMock).not.toHaveBeenCalled();
    expect(composeFromFragmentsMock).not.toHaveBeenCalled();
    expect(callEntryDraftingAdapterMock).not.toHaveBeenCalled();
  });

  it("falls back to the built-in knowledge base when the DB fetch fails, instead of 500ing", async () => {
    getKnowledgeBaseMock.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeRequest({ raw_word_dump: "Played chess with dad", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0].source).toBe("knowledge_base");
  });

  it("still classifies successfully when the research-citations fetch fails", async () => {
    getResearchCitationsMock.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeRequest({ raw_word_dump: "Played chess with dad", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(true);
  });

  it("tries Stage 2 retrieval when Stage 1 only found a generic heuristic cluster", async () => {
    await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    expect(findRetrievalMatchMock).toHaveBeenCalledWith(expect.anything(), STUDENT_ID, "Read a book before bed");
  });

  it("uses a Stage 2 retrieval match's snapshot tags when one is found", async () => {
    findRetrievalMatchMock.mockResolvedValue({
      entryId: "entry-1",
      similarity: 0.95,
      snapshot: { tags: [{ subjectArea: "Music", courseTitle: "Piano Practice", creditValue: 0.25, reasoning: "Past accepted entry." }] },
    });
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    const body = await res.json();
    expect(body.tags[0].source).toBe("retrieval");
    expect(body.tags[0].subjectArea).toBe("Music");
    expect(body.tags[0].confidence).toBe("high"); // similarity 0.95 >= 0.9
    expect(body.tags[0].quotedPhrase).toBeNull();
  });

  it("maps retrieval similarity to medium/low confidence bands correctly", async () => {
    findRetrievalMatchMock.mockResolvedValue({
      entryId: "entry-1",
      similarity: 0.82,
      snapshot: { tags: [{ subjectArea: "Music", courseTitle: "Piano Practice", creditValue: 0.25, reasoning: "..." }] },
    });
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    expect((await res.json()).tags[0].confidence).toBe("medium");

    findRetrievalMatchMock.mockResolvedValue({
      entryId: "entry-1",
      similarity: 0.76,
      snapshot: { tags: [{ subjectArea: "Music", courseTitle: "Piano Practice", creditValue: 0.25, reasoning: "..." }] },
    });
    const res2 = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    expect((await res2.json()).tags[0].confidence).toBe("low");
  });

  it("degrades to falling through (not a 500) when the retrieval lookup itself throws", async () => {
    findRetrievalMatchMock.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(true);
    expect(body.tags[0].source).toBe("heuristic_cluster");
  });

  it("upgrades a heuristic-cluster tag via Stage 3 fragment composition when no retrieval match is found", async () => {
    composeFromFragmentsMock.mockResolvedValue({ courseTitle: "Assembled Literature Study", reasoning: "Composed from fragments." });
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    const body = await res.json();
    expect(body.tags[0].source).toBe("fragment_composition");
    expect(body.tags[0].courseTitle).toBe("Assembled Literature Study");
  });

  it("keeps the plain heuristic-cluster tag when Stage 3 composition finds nothing", async () => {
    composeFromFragmentsMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    const body = await res.json();
    expect(body.tags[0].source).toBe("heuristic_cluster");
  });

  it("degrades to the plain heuristic-cluster tag (not a 500) when Stage 3 composition throws", async () => {
    composeFromFragmentsMock.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeRequest({ raw_word_dump: "Read a book before bed", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0].source).toBe("heuristic_cluster");
  });

  it("falls through to Stage 4 when Stage 1-3 all miss, attaching a draft candidate if the adapter produces one", async () => {
    callEntryDraftingAdapterMock.mockResolvedValue({
      subjectArea: "Science",
      courseTitle: "Applied Chemistry Basics",
      creditValue: 0.25,
      rationale: "A plausible fallback rationale long enough to pass validation.",
    });
    const res = await POST(makeRequest({ raw_word_dump: "Zzyzx quaplorp fribbet nonsense words", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(false);
    expect(body.draftCandidate).toEqual(
      expect.objectContaining({ subjectArea: "Science", courseTitle: "Applied Chemistry Basics" })
    );
  });

  it("returns draftCandidate: null when Stage 4 also finds nothing", async () => {
    const res = await POST(makeRequest({ raw_word_dump: "Zzyzx quaplorp fribbet nonsense words", student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confident).toBe(false);
    expect(body.draftCandidate).toBeNull();
  });

  it("never calls Stage 4 when Stage 1 already returned a confident result", async () => {
    await POST(makeRequest({ raw_word_dump: "Played chess with dad", student_id: STUDENT_ID }));
    expect(callEntryDraftingAdapterMock).not.toHaveBeenCalled();
  });
});
