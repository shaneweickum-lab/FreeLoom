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

describe("POST /api/admin/access-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [];
  });

  it("rejects a non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }];
    const res = await POST(makeRequest({ email: "parent@example.com", reason: "debugging" }));
    expect(res.status).toBe(403);
  });

  it("requires a reason", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    const res = await POST(makeRequest({ email: "parent@example.com", reason: "" }));
    expect(res.status).toBe(400);
  });

  it("404s when no account exists with that email", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    listUsersMock.mockResolvedValue({ data: { users: [] }, error: null });
    const res = await POST(makeRequest({ email: "nobody@example.com", reason: "debugging" }));
    expect(res.status).toBe(404);
  });

  it("refuses a self-targeted request", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    listUsersMock.mockResolvedValue({ data: { users: [{ id: ADMIN.id, email: ADMIN.email }] }, error: null });
    const res = await POST(makeRequest({ email: ADMIN.email, reason: "debugging" }));
    expect(res.status).toBe(400);
  });

  it("creates the request and notifies the target parent", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: { id: "req-1" }, error: null }, { error: null }];
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "parent-1", email: "parent@example.com" }] },
      error: null,
    });
    const res = await POST(makeRequest({ email: "parent@example.com", reason: "Portfolio isn't loading" }));
    expect(res.status).toBe(200);
  });
});
