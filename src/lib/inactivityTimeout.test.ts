import { describe, expect, it } from "vitest";
import { INACTIVITY_TIMEOUT_MS, isInactive } from "./inactivityTimeout";

describe("isInactive", () => {
  const now = new Date("2026-01-10T00:00:00.000Z").getTime();

  it("is not inactive when there's no prior timestamp", () => {
    expect(isInactive(undefined, now)).toBe(false);
    expect(isInactive(null, now)).toBe(false);
    expect(isInactive("", now)).toBe(false);
  });

  it("is not inactive when the timestamp can't be parsed", () => {
    expect(isInactive("not-a-date", now)).toBe(false);
  });

  it("is not inactive just under the 72h window", () => {
    const lastActive = new Date(now - INACTIVITY_TIMEOUT_MS + 1000).toISOString();
    expect(isInactive(lastActive, now)).toBe(false);
  });

  it("is inactive just over the 72h window", () => {
    const lastActive = new Date(now - INACTIVITY_TIMEOUT_MS - 1000).toISOString();
    expect(isInactive(lastActive, now)).toBe(true);
  });

  it("is not inactive for a very recent timestamp", () => {
    const lastActive = new Date(now - 1000).toISOString();
    expect(isInactive(lastActive, now)).toBe(false);
  });
});
