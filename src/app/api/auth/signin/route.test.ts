import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const signInWithPasswordMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword: signInWithPasswordMock },
  })),
}));

const isRateLimitedMock = vi.fn(() => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: () => isRateLimitedMock(),
  getClientIp: () => "1.2.3.4",
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

describe("POST /api/auth/signin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  it("429s once the rate limit is hit, without touching Supabase", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ email: "parent@example.com", password: "hunter22" }));
    expect(res.status).toBe(429);
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("400s when email or password is missing", async () => {
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(400);
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("400s with Supabase's own error message on bad credentials", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const res = await POST(makeRequest({ email: "parent@example.com", password: "wrong" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid login credentials");
  });

  it("returns ok on success", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ email: "parent@example.com", password: "hunter22" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "parent@example.com", password: "hunter22" });
  });
});
