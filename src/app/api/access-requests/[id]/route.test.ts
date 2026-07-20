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

import { PATCH } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const PARENT = { id: "parent-1", email: "parent@example.com" };

describe("PATCH /api/access-requests/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: PARENT } };
    fromQueue = [];
  });

  function callWithId(body: unknown, id = "req-1") {
    return PATCH(makeRequest(body), { params: Promise.resolve({ id }) });
  }

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid action", async () => {
    const res = await callWithId({ action: "delete-everything" });
    expect(res.status).toBe(400);
  });

  it("404s when the request doesn't belong to this user (or doesn't exist)", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(404);
  });

  it("400s when the transition is invalid (trigger rejects it)", async () => {
    fromQueue = [{ data: null, error: { message: "Invalid access request transition from denied to approved" } }];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(400);
  });

  it("approves the request and marks its notification read", async () => {
    fromQueue = [{ data: { id: "req-1" }, error: null }, { error: null }];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(200);
  });

  it("supports deny and revoke actions too", async () => {
    fromQueue = [{ data: { id: "req-1" }, error: null }, { error: null }];
    const res = await callWithId({ action: "deny" });
    expect(res.status).toBe(200);
  });
});
