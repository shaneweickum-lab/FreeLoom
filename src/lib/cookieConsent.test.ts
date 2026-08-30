import { describe, expect, it } from "vitest";
import { normalizeStoredConsent } from "./cookieConsent";

describe("normalizeStoredConsent", () => {
  it("returns null for a missing/null value", () => {
    expect(normalizeStoredConsent(null)).toBeNull();
    expect(normalizeStoredConsent(undefined)).toBeNull();
  });

  it("returns null when analytics or marketing isn't a boolean (not a valid record at all)", () => {
    expect(normalizeStoredConsent({ marketing: true, aiModel: true, decidedAt: "x" })).toBeNull();
    expect(normalizeStoredConsent({ analytics: true, aiModel: true, decidedAt: "x" })).toBeNull();
    expect(normalizeStoredConsent({ analytics: "yes", marketing: true })).toBeNull();
  });

  it("passes through a full, current-shape record unchanged", () => {
    const result = normalizeStoredConsent({ analytics: true, marketing: false, aiModel: true, decidedAt: "2026-01-01T00:00:00.000Z" });
    expect(result).toEqual({ analytics: true, marketing: false, aiModel: true, decidedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("backfills aiModel to false for a pre-existing record saved before that category existed", () => {
    const result = normalizeStoredConsent({ analytics: true, marketing: true, decidedAt: "2025-06-01T00:00:00.000Z" });
    expect(result).toEqual({ analytics: true, marketing: true, aiModel: false, decidedAt: "2025-06-01T00:00:00.000Z" });
  });

  it("never treats an old decision as an implicit yes to aiModel, even when the other categories were accepted", () => {
    const result = normalizeStoredConsent({ analytics: true, marketing: true, decidedAt: "2025-06-01T00:00:00.000Z" });
    expect(result?.aiModel).toBe(false);
  });
});
