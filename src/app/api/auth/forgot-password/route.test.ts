import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const resetPasswordForEmailMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { resetPasswordForEmail: resetPasswordForEmailMock },
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

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  it("429s once the rate limit is hit, without touching Supabase", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(429);
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it("400s when email is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it("returns ok and passes redirectTo through on success", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ email: "parent@example.com", redirectTo: "https://app/auth/confirm" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("parent@example.com", { redirectTo: "https://app/auth/confirm" });
  });

  it("400s with Supabase's own error message on failure", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Email rate limit exceeded");
  });
});
