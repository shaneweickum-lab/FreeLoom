import { beforeEach, describe, expect, it, vi } from "vitest";

/** Thenable chain -- awaitable directly (for a terminal `.eq()`/`.update()`
 * call with no further `.select()`/`.maybeSingle()`), and every filter
 * method returns the same object so any chain length still resolves to
 * the queued result. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  for (const method of ["select", "eq", "update"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
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

const GUARDIAN = { id: "guardian-1", email: "guardian@example.com" };

describe("POST /api/household/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: GUARDIAN } };
    fromQueue = [];
  });

  it("401s when not signed in", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("404s when there's no matching pending invite", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("accepts a matching pending invite", async () => {
    fromQueue = [{ data: { id: "invite-1" }, error: null }, { data: null, error: null }];
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("500s when the update fails", async () => {
    fromQueue = [{ data: { id: "invite-1" }, error: null }, { data: null, error: { message: "boom" } }];
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
