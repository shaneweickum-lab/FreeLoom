import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const insertMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ insert: insertMock }),
  })),
}));

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
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

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    isRateLimitedMock.mockReturnValue(false);
  });

  it("429s once the rate limit is hit", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email without touching the database", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts a trimmed, lowercased email and returns ok", async () => {
    insertMock.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ email: "  Parent@Example.com  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledWith({ email: "parent@example.com" });
  });

  it("treats a duplicate signup (unique violation) as success", async () => {
    insertMock.mockResolvedValue({ error: { code: "23505" } });
    const res = await POST(makeRequest({ email: "again@example.com" }));
    expect(res.status).toBe(200);
  });

  it("returns 500 on a real database error", async () => {
    insertMock.mockResolvedValue({ error: { code: "XX000" } });
    const res = await POST(makeRequest({ email: "broken@example.com" }));
    expect(res.status).toBe(500);
  });

  it("sends a confirmation email when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "test-key";
    insertMock.mockResolvedValue({ error: null });
    sendMock.mockResolvedValue({});
    await POST(makeRequest({ email: "parent@example.com" }));
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "parent@example.com", from: expect.stringContaining("resend.dev") })
    );
  });

  it("still returns ok if the confirmation email fails to send", async () => {
    process.env.RESEND_API_KEY = "test-key";
    insertMock.mockResolvedValue({ error: null });
    sendMock.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest({ email: "parent@example.com" }));
    expect(res.status).toBe(200);
  });

  it("skips sending when RESEND_API_KEY is unset", async () => {
    insertMock.mockResolvedValue({ error: null });
    await POST(makeRequest({ email: "parent@example.com" }));
    expect(sendMock).not.toHaveBeenCalled();
  });
});
