import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getClientIp, isRateLimited } from "./rateLimit";

describe("isRateLimited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const key = `test-under-${Math.random()}`;
    expect(isRateLimited(key, 3, 60_000)).toBe(false);
    expect(isRateLimited(key, 3, 60_000)).toBe(false);
    expect(isRateLimited(key, 3, 60_000)).toBe(false);
  });

  it("blocks once the limit is exceeded within the window", () => {
    const key = `test-over-${Math.random()}`;
    expect(isRateLimited(key, 2, 60_000)).toBe(false);
    expect(isRateLimited(key, 2, 60_000)).toBe(false);
    expect(isRateLimited(key, 2, 60_000)).toBe(true);
  });

  it("resets after the window elapses", () => {
    const key = `test-reset-${Math.random()}`;
    expect(isRateLimited(key, 1, 60_000)).toBe(false);
    expect(isRateLimited(key, 1, 60_000)).toBe(true);
    vi.setSystemTime(60_001);
    expect(isRateLimited(key, 1, 60_000)).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    expect(isRateLimited(keyA, 1, 60_000)).toBe(false);
    expect(isRateLimited(keyA, 1, 60_000)).toBe(true);
    expect(isRateLimited(keyB, 1, 60_000)).toBe(false);
  });
});

describe("getClientIp", () => {
  function makeRequest(headers: Record<string, string>) {
    return { headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } } as unknown as Parameters<typeof getClientIp>[0];
  }

  it("takes the first entry from x-forwarded-for", () => {
    expect(getClientIp(makeRequest({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(getClientIp(makeRequest({ "x-real-ip": "9.8.7.6" }))).toBe("9.8.7.6");
  });

  it("falls back to \"unknown\" when neither header is present", () => {
    expect(getClientIp(makeRequest({}))).toBe("unknown");
  });
});
