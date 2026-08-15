import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.upsert = vi.fn(async () => result);
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

const isRateLimitedMock = vi.fn(() => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: () => isRateLimitedMock(),
}));

const sendEmailMock = vi.fn<(options: { to: string }) => Promise<unknown>>(async () => ({}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (options: { to: string }) => sendEmailMock(options) };
  },
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const OWNER = { id: "owner-1", email: "owner@example.com" };

describe("POST /api/household/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: OWNER } };
    fromQueue = [];
    isRateLimitedMock.mockReturnValue(false);
    delete process.env.RESEND_API_KEY;
  });

  it("401s when not signed in", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(401);
  });

  it("429s when rate-limited", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(429);
  });

  it("400s on a malformed email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("400s when inviting yourself", async () => {
    const res = await POST(makeRequest({ email: "OWNER@example.com" }));
    expect(res.status).toBe(400);
  });

  it("403s when the caller doesn't own a school_profiles row", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(403);
  });

  it("400s when that email is already an accepted guardian", async () => {
    fromQueue = [
      { data: { parent_name: "Jamie" }, error: null },
      { data: { id: "member-1", status: "accepted" }, error: null },
    ];
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(400);
  });

  it("invites successfully and sends an email when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "test-key";
    fromQueue = [
      { data: { parent_name: "Jamie" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "guardian@example.com" }));
  });

  it("still succeeds without RESEND_API_KEY set (invite saved, email skipped)", async () => {
    fromQueue = [
      { data: { parent_name: "Jamie" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("500s when the upsert fails", async () => {
    fromQueue = [
      { data: { parent_name: "Jamie" }, error: null },
      { data: null, error: null },
      { data: null, error: { message: "boom" } },
    ];
    const res = await POST(makeRequest({ email: "guardian@example.com" }));
    expect(res.status).toBe(500);
  });
});
