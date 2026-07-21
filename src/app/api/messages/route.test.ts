import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Builds a chainable + awaitable fake query result -- see
 * src/app/api/admin/admins/route.test.ts for the original version of this
 * helper; extended here with update/is for the PATCH mark-read chain. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "delete", "update", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string; email: string } | null } };
let fromQueue: unknown[];
let adminFromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => chain(adminFromQueue.shift() ?? { data: null, error: null })),
  })),
}));

import { PATCH, POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const PARENT = { id: "parent-1", email: "parent@example.com" };
const ADMIN = { id: "admin-1", email: "shane@sowedandrooted.com" };
const THREAD_ID = "thread-1";
const PARENT_THREAD = { id: THREAD_ID, parent_user_id: PARENT.id };

describe("POST /api/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: PARENT } };
    fromQueue = [];
    adminFromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "hello" }));
    expect(res.status).toBe(401);
  });

  it("requires a threadId", async () => {
    fromQueue = [{ data: null }]; // requireAdmin's admin_users lookup: not an admin
    const res = await POST(makeRequest({ body: "hello" }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty message", async () => {
    fromQueue = [{ data: null }];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "   " }));
    expect(res.status).toBe(400);
  });

  it("404s when the thread doesn't exist", async () => {
    fromQueue = [{ data: null }, { data: null }];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "hello" }));
    expect(res.status).toBe(404);
  });

  it("403s when a non-admin's threadId belongs to someone else", async () => {
    fromQueue = [{ data: null }, { data: { id: THREAD_ID, parent_user_id: "someone-else" } }];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "hello" }));
    expect(res.status).toBe(403);
  });

  it("lets a parent send into their own thread and fans out notifications to admins via service role", async () => {
    fromQueue = [{ data: null }, { data: PARENT_THREAD }, { error: null }, { data: { parent_name: "Jane Doe" } }];
    adminFromQueue = [
      { data: [{ user_id: "admin-1" }, { user_id: "admin-2" }], error: null },
      { error: null },
    ];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "Something's broken" }));
    expect(res.status).toBe(200);
  });

  it("lets an admin reply into a specific parent's thread", async () => {
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [
      { data: { user_id: ADMIN.id } },
      { data: PARENT_THREAD },
      { error: null },
      { data: null }, // recipient's notification-preference lookup -- no row, defaults apply
      { error: null },
    ];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "reply" }));
    expect(res.status).toBe(200);
  });

  it("500s on a real insert failure", async () => {
    fromQueue = [{ data: null }, { data: PARENT_THREAD }, { error: { code: "XX000" } }];
    const res = await POST(makeRequest({ threadId: THREAD_ID, body: "hello" }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: PARENT } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await PATCH(makeRequest({ threadId: THREAD_ID }));
    expect(res.status).toBe(401);
  });

  it("requires a threadId", async () => {
    fromQueue = [{ data: null }];
    const res = await PATCH(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("404s when the thread doesn't exist", async () => {
    fromQueue = [{ data: null }, { data: null }];
    const res = await PATCH(makeRequest({ threadId: THREAD_ID }));
    expect(res.status).toBe(404);
  });

  it("403s when a non-admin's threadId belongs to someone else", async () => {
    fromQueue = [{ data: null }, { data: { id: THREAD_ID, parent_user_id: "someone-else" } }];
    const res = await PATCH(makeRequest({ threadId: THREAD_ID }));
    expect(res.status).toBe(403);
  });

  it("marks the admin team's messages read for a parent", async () => {
    fromQueue = [{ data: null }, { data: PARENT_THREAD }, { error: null }];
    const res = await PATCH(makeRequest({ threadId: THREAD_ID }));
    expect(res.status).toBe(200);
  });

  it("marks a parent's messages read for an admin caller", async () => {
    getUserResult = { data: { user: ADMIN } };
    fromQueue = [{ data: { user_id: ADMIN.id } }, { data: PARENT_THREAD }, { error: null }];
    const res = await PATCH(makeRequest({ threadId: THREAD_ID }));
    expect(res.status).toBe(200);
  });
});
