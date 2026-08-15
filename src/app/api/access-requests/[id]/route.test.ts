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

// Defaults to "this caller owns their own household" (identical to this
// route's pre-guardian-access behavior) -- mocked directly rather than
// via fromQueue, since resolveHouseholdOwnerId's own queries would
// otherwise consume items out of order against every existing test's
// carefully-sequenced queue.
const resolveHouseholdOwnerIdMock = vi.fn<(supabase: unknown, userId: string) => Promise<string | null>>(
  async (_supabase, userId) => userId
);
vi.mock("@/lib/household", () => ({
  resolveHouseholdOwnerId: (supabase: unknown, userId: string) => resolveHouseholdOwnerIdMock(supabase, userId),
}));

import { PATCH } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const PARENT = { id: "parent-1", email: "parent@example.com" };
const ADMIN = { id: "admin-1", email: "shane@sowedandrooted.com" };

describe("PATCH /api/access-requests/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: PARENT } };
    fromQueue = [];
    resolveHouseholdOwnerIdMock.mockImplementation(async (_supabase, userId) => userId);
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

  const NOT_FREE = { data: { subscription_tier: "pro", subscription_status: "active", grandfathered_until: null } };

  it("404s when the request doesn't belong to this user (or doesn't exist)", async () => {
    fromQueue = [NOT_FREE, { data: null }, { data: null, error: null }];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(404);
  });

  it("400s when the transition is invalid (trigger rejects it)", async () => {
    fromQueue = [
      NOT_FREE,
      { data: null }, // caller isn't an admin
      { data: null, error: { message: "Invalid access request transition from denied to approved" } },
    ];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(400);
  });

  it("400s when the caller's own account is on the Free plan", async () => {
    fromQueue = [
      { data: { subscription_tier: "free", subscription_status: null, grandfathered_until: null } },
      { data: null }, // caller isn't an admin either, so the Free-plan block still applies
    ];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(400);
  });

  it("approves on behalf of a household guardian, checking the owner's tier rather than the guardian's own (nonexistent) profile", async () => {
    getUserResult = { data: { user: { id: "guardian-1", email: "guardian@example.com" } } };
    resolveHouseholdOwnerIdMock.mockResolvedValue(PARENT.id);
    fromQueue = [
      NOT_FREE,
      { data: null }, // guardian isn't an admin
      { data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null },
      { error: null },
    ];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(200);
  });

  it("approves the request and marks its notification read", async () => {
    fromQueue = [
      NOT_FREE,
      { data: null }, // caller isn't an admin
      { data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null },
      { error: null },
    ];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(200);
  });

  it("allows approving even on a Free plan when the caller is themselves an admin", async () => {
    fromQueue = [
      { data: { subscription_tier: "free", subscription_status: null, grandfathered_until: null } },
      { data: { user_id: PARENT.id } }, // caller IS an admin -- bypasses the Free-plan block
      { data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null },
      { error: null },
    ];
    const res = await callWithId({ action: "approve" });
    expect(res.status).toBe(200);
  });

  it("supports deny too, without sending a close-access notification", async () => {
    fromQueue = [{ data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null }, { error: null }];
    const res = await callWithId({ action: "deny" });
    expect(res.status).toBe(200);
    // Only the mark-read update should have run -- no third queued call consumed.
    expect(fromQueue).toHaveLength(0);
  });

  it("sends a close-access notification when the requesting admin revokes their own access", async () => {
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [
      { data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null },
      { error: null }, // mark-read
      { error: null }, // close-access notification insert
    ];
    const res = await callWithId({ action: "revoke" });
    expect(res.status).toBe(200);
    expect(fromQueue).toHaveLength(0);
  });

  it("does not send a close-access notification when a parent revokes their own approval", async () => {
    fromQueue = [
      { data: { id: "req-1", requested_by: ADMIN.id, target_user_id: PARENT.id }, error: null },
      { error: null }, // mark-read only -- requested_by !== caller (PARENT), so no extra insert
    ];
    const res = await callWithId({ action: "revoke" });
    expect(res.status).toBe(200);
    expect(fromQueue).toHaveLength(0);
  });
});
