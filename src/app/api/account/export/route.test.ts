import { beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string } | null } };
let fromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

import { GET } from "./route";

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: { id: "user-1" } } };
    fromQueue = [];
  });

  it("401s when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns a full nested export with the expected filename header", async () => {
    fromQueue = [
      { data: { user_id: "user-1", subscription_tier: "free" }, error: null }, // school_profiles
      { data: [{ id: "student-1", name: "Alex" }], error: null }, // students
      { data: [{ id: "notif-1" }], error: null }, // notifications
      { data: [], error: null }, // account_access_requests
      { data: [{ id: "class-1", student_id: "student-1" }], error: null }, // classes
      { data: [{ id: "entry-1", student_id: "student-1" }], error: null }, // entries
      { data: [], error: null }, // entry_subject_tags
      { data: [], error: null }, // profile_notes
      { data: [], error: null }, // transcripts
      { data: [{ id: "thread-1" }], error: null }, // support_threads
      { data: [], error: null }, // benny_conversations
      { data: [{ id: "msg-1", thread_id: "thread-1" }], error: null }, // support_messages
    ];

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="freeloom-export-\d{4}-\d{2}-\d{2}\.json"$/);

    const body = await res.json();
    expect(body.account).toEqual({ user_id: "user-1", subscription_tier: "free" });
    expect(body.students).toHaveLength(1);
    expect(body.students[0].classes).toEqual([{ id: "class-1", student_id: "student-1" }]);
    expect(body.students[0].entries).toEqual([{ id: "entry-1", student_id: "student-1" }]);
    expect(body.support_threads[0].messages).toEqual([{ id: "msg-1", thread_id: "thread-1" }]);
    expect(body.notifications).toEqual([{ id: "notif-1" }]);
  });

  it("doesn't crash when the account has no students yet", async () => {
    fromQueue = [
      { data: null, error: null }, // school_profiles
      { data: [], error: null }, // students
      { data: [], error: null }, // notifications
      { data: [], error: null }, // account_access_requests
      { data: [], error: null }, // support_threads
      { data: [], error: null }, // benny_conversations
    ];

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toEqual([]);
    expect(body.support_threads).toEqual([]);
    expect(body.benny_conversations).toEqual([]);
  });
});
