import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "delete", "update", "is"]) {
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
  });

  it("rejects a non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }];
    const res = await POST(makeRequest({ title: "t", body: "b" }));
    expect(res.status).toBe(403);
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
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: { id: "ann-1" }, error: null }, { error: null }];
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
});
