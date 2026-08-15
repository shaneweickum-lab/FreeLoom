import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "insert", "delete", "update", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string; email: string } | null } };
let fromQueue: unknown[];
const listUsersMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { listUsers: listUsersMock } },
  })),
}));

const isRateLimitedMock = vi.fn(() => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: () => isRateLimitedMock(),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const ADMIN = { id: "admin-1", email: "shane@sowedandrooted.com" };
const NON_ADMIN = { id: "user-2", email: "someone@example.com" };

describe("POST /api/admin/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [];
    isRateLimitedMock.mockReturnValue(false);
  });

  it("rejects a non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }];
    const res = await POST(makeRequest({ title: "t", body: "b" }));
    expect(res.status).toBe(403);
  });

  it("429s once the rate limit is hit", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ title: "t", body: "b" }));
    expect(res.status).toBe(429);
  });

  it("requires both a title and a body", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ title: "", body: "b" }));
    expect(res.status).toBe(400);
  });

  it("500s when the announcement insert fails", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: null, error: { code: "XX000" } }];
    const res = await POST(makeRequest({ title: "t", body: "b" }));
    expect(res.status).toBe(500);
  });

  it("posts the announcement and fans out a notification to every user", async () => {
    fromQueue = [
      { data: { user_id: ADMIN.id } },
      { data: { id: "ann-1" }, error: null },
      { data: [], error: null }, // per-recipient notification-preference lookup
      { error: null },
    ];
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "u1" }, { id: "u2" }] },
      error: null,
    });
    const res = await POST(makeRequest({ title: "New feature", body: "It ships today." }));
    expect(res.status).toBe(200);
  });

  it("still succeeds if the fanout lookup itself fails (best-effort)", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: { id: "ann-1" }, error: null }];
    listUsersMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(makeRequest({ title: "New feature", body: "It ships today." }));
    expect(res.status).toBe(200);
  });

  it("rejects an unrecognized audience", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ title: "t", body: "b", targetType: "everyone-in-the-solar-system" }));
    expect(res.status).toBe(400);
  });

  it("requires targetUserId when targeting a single user", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ title: "t", body: "b", targetType: "user" }));
    expect(res.status).toBe(400);
  });

  it("sends to just the one target user without calling listUsers", async () => {
    fromQueue = [
      { data: { user_id: ADMIN.id } },
      { data: { id: "ann-1" }, error: null },
      { data: [], error: null }, // per-recipient notification-preference lookup
      { error: null },
    ];
    const res = await POST(makeRequest({ title: "t", body: "b", targetType: "user", targetUserId: "parent-1" }));
    expect(res.status).toBe(200);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("requires a valid schooling type when targeting a group", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ title: "t", body: "b", targetType: "schooling_type", targetSchoolingType: "space camp" }));
    expect(res.status).toBe(400);
  });

  it("fans out to every account matching the targeted schooling type", async () => {
    fromQueue = [
      { data: { user_id: ADMIN.id } },
      { data: { id: "ann-1" }, error: null },
      { data: [{ user_id: "u1" }, { user_id: "u2" }], error: null },
      { data: [], error: null }, // per-recipient notification-preference lookup
      { error: null },
    ];
    const res = await POST(
      makeRequest({ title: "t", body: "b", targetType: "schooling_type", targetSchoolingType: "unschooling" })
    );
    expect(res.status).toBe(200);
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});
