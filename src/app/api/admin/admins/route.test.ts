import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Builds a chainable + awaitable fake query result. select/eq/insert/delete
 * all return the same object so any chain shape resolves, whether the route
 * awaits after .maybeSingle(), a bare .select(), or a bare .eq()/.insert(). */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
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

const listUsersMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { listUsers: listUsersMock } },
  })),
}));

import { DELETE, POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const ADMIN = { id: "admin-1", email: "shane@sowedandrooted.com" };
const NON_ADMIN = { id: "user-2", email: "someone@example.com" };

describe("POST /api/admin/admins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ email: "new@example.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects a signed-in non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }]; // requireAdmin's admin_users lookup finds nothing
    const res = await POST(makeRequest({ email: "new@example.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid email", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }]; // caller is an admin
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("404s when no account exists with that email", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }];
    listUsersMock.mockResolvedValue({ data: { users: [] }, error: null });
    const res = await POST(makeRequest({ email: "nobody@example.com" }));
    expect(res.status).toBe(404);
  });

  it("approves an existing account as admin", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { error: null }];
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "user-3", email: "parent@example.com" }] },
      error: null,
    });
    const res = await POST(makeRequest({ email: "Parent@Example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("treats an already-admin unique violation as success", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { error: { code: "23505" } }];
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "user-3", email: "parent@example.com" }] },
      error: null,
    });
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/admins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [];
  });

  it("rejects a signed-in non-admin", async () => {
    getUserResult = { data: { user: NON_ADMIN } };
    fromQueue = [{ data: null }];
    const res = await DELETE(makeRequest({ userId: "user-3" }));
    expect(res.status).toBe(403);
  });

  it("refuses to remove the last admin", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { count: 1 }];
    const res = await DELETE(makeRequest({ userId: ADMIN.id }));
    expect(res.status).toBe(400);
  });

  it("removes an admin when others remain", async () => {
    fromQueue = [{ data: { user_id: ADMIN.id } }, { count: 2 }, { error: null }];
    const res = await DELETE(makeRequest({ userId: "user-3" }));
    expect(res.status).toBe(200);
  });
});
