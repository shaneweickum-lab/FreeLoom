import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const signUpMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: signUpMock },
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

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  it("429s once the rate limit is hit, without touching Supabase", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ email: "parent@example.com", password: "hunter222" }));
    expect(res.status).toBe(429);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("400s when email or password is missing", async () => {
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(400);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("400s with Supabase's own error message on failure", async () => {
    signUpMock.mockResolvedValue({ data: {}, error: { message: "User already registered" } });
    const res = await POST(makeRequest({ email: "parent@example.com", password: "hunter222" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("User already registered");
  });

  it("reports hasSession: true when signup returns an immediate session", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const res = await POST(makeRequest({ email: "parent@example.com", password: "hunter222" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSession: true });
  });

  it("reports hasSession: false when signup requires email confirmation first", async () => {
    signUpMock.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(
      makeRequest({ email: "parent@example.com", password: "hunter222", emailRedirectTo: "https://app/auth/confirm" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSession: false });
    expect(signUpMock).toHaveBeenCalledWith({
      email: "parent@example.com",
      password: "hunter222",
      options: { emailRedirectTo: "https://app/auth/confirm" },
    });
  });
});
