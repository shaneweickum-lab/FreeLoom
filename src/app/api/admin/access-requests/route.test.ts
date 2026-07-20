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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const ADMIN = { id: "admin-1", email: "shane@sowedandrooted.com" };
const NON_ADMIN = { id: "user-2", email: "someone@example.com" };
const PARENT_ID = "parent-1";

describe("POST /api/admin/access-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [];
  });

  it("rejects a non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }];
    const res = await POST(makeRequest({ targetUserId: PARENT_ID, reason: "debugging" }));
    expect(res.status).toBe(403);
  });

  it("requires a target account", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ reason: "debugging" }));
    expect(res.status).toBe(400);
  });

  it("requires a reason", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ targetUserId: PARENT_ID, reason: "" }));
    expect(res.status).toBe(400);
  });

  it("refuses a self-targeted request", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ targetUserId: ADMIN.id, reason: "debugging" }));
    expect(res.status).toBe(400);
  });

  it("creates the request and notifies the target parent", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: { id: "req-1" }, error: null }, { error: null }];
    const res = await POST(makeRequest({ targetUserId: PARENT_ID, reason: "Portfolio isn't loading" }));
    expect(res.status).toBe(200);
  });

  it("500s when the request insert fails", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: null, error: { code: "XX000" } }];
    const res = await POST(makeRequest({ targetUserId: PARENT_ID, reason: "debugging" }));
    expect(res.status).toBe(500);
  });
});
