import { describe, expect, it, vi } from "vitest";
import { findRetrievalMatch, recordRetrievalCase } from "./retrieve";

function fakeSupabase(rpcResult: { data: unknown; error: unknown }) {
  const insertMock = vi.fn(async () => ({ error: null }));
  const rpcMock = vi.fn(async () => rpcResult);
  const fromMock = vi.fn(() => ({ insert: insertMock }));
  return {
    supabase: { rpc: rpcMock, from: fromMock } as unknown as Parameters<typeof findRetrievalMatch>[0],
    rpcMock,
    insertMock,
    fromMock,
  };
}

describe("findRetrievalMatch", () => {
  it("returns the closest prior entry's snapshot when the RPC finds one", async () => {
    const snapshot = { tags: [{ subjectArea: "Mathematics", courseTitle: "Algebra I", creditValue: 0.5, reasoning: "..." }] };
    const { supabase, rpcMock } = fakeSupabase({
      data: [{ entry_id: "entry-1", accepted_output_snapshot: snapshot, similarity: 0.91 }],
      error: null,
    });
    const match = await findRetrievalMatch(supabase, "student-1", "played chess with dad");
    expect(match).toEqual({ entryId: "entry-1", snapshot, similarity: 0.91 });
    expect(rpcMock).toHaveBeenCalledWith(
      "match_retrieval_case",
      expect.objectContaining({ p_student_id: "student-1", p_match_threshold: 0.75 })
    );
  });

  it("returns null when the RPC finds nothing above the threshold", async () => {
    const { supabase } = fakeSupabase({ data: [], error: null });
    expect(await findRetrievalMatch(supabase, "student-1", "some novel activity")).toBeNull();
  });

  it("returns null (not a thrown error) when the RPC itself fails", async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: "connection reset" } });
    expect(await findRetrievalMatch(supabase, "student-1", "played chess")).toBeNull();
  });

  it("passes a custom match threshold through to the RPC instead of the 0.75 default", async () => {
    const { supabase, rpcMock } = fakeSupabase({ data: [], error: null });
    await findRetrievalMatch(supabase, "student-1", "played chess", 0.9);
    expect(rpcMock).toHaveBeenCalledWith("match_retrieval_case", expect.objectContaining({ p_match_threshold: 0.9 }));
  });
});

describe("recordRetrievalCase", () => {
  it("inserts a retrieval_cases row with a vectorized word dump and the accepted snapshot", async () => {
    const { supabase, fromMock, insertMock } = fakeSupabase({ data: null, error: null });
    const snapshot = { tags: [{ subjectArea: "Mathematics", courseTitle: "Algebra I", creditValue: 0.5, reasoning: "..." }] };
    await recordRetrievalCase(supabase, "entry-1", "did some algebra homework", snapshot);
    expect(fromMock).toHaveBeenCalledWith("retrieval_cases");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ entry_id: "entry-1", accepted_output_snapshot: snapshot })
    );
  });

  it("does not throw when the insert fails -- best-effort, logged not propagated", async () => {
    const insertMock = vi.fn(async () => ({ error: { message: "constraint violation" } }));
    const supabase = { from: () => ({ insert: insertMock }) } as unknown as Parameters<typeof recordRetrievalCase>[0];
    await expect(recordRetrievalCase(supabase, "entry-1", "text", { tags: [] })).resolves.toBeUndefined();
  });
});
