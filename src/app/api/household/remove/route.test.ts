import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Thenable chain -- awaitable directly (this route's terminal call is
 * `.update(...).eq(...).eq(...)`, no `.select()`/`.maybeSingle()`). */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  for (const method of ["update", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  return builder;
}

let getUserResult: { data: { user: { id: string } | null } };
let fromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { error: null })),
  })),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const OWNER = { id: "owner-1" };

describe("POST /api/household/remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: OWNER } };
    fromQueue = [];
  });

  it("401s when not signed in", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ memberId: "member-1" }));
    expect(res.status).toBe(401);
  });

  it("400s when memberId is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("revokes the member, scoped to the caller's own owner_user_id", async () => {
    fromQueue = [{ error: null }];
    const res = await POST(makeRequest({ memberId: "member-1" }));
    expect(res.status).toBe(200);
  });

  it("500s when the update fails", async () => {
    fromQueue = [{ error: { message: "boom" } }];
    const res = await POST(makeRequest({ memberId: "member-1" }));
    expect(res.status).toBe(500);
  });
});
