import { describe, expect, it } from "vitest";
import { getEffectiveTier, getStudentCap, isRetentionDaysAllowed } from "./tier";

const FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
const PAST = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

describe("getEffectiveTier", () => {
  it("defaults to free with no subscription and no grandfathering", () => {
    expect(getEffectiveTier({ subscription_tier: "free", subscription_status: null, grandfathered_until: null })).toBe(
      "free"
    );
  });

  it("trusts subscription_tier when status is active", () => {
    expect(
      getEffectiveTier({ subscription_tier: "pro", subscription_status: "active", grandfathered_until: null })
    ).toBe("pro");
  });

  it("trusts subscription_tier when status is trialing", () => {
    expect(
      getEffectiveTier({ subscription_tier: "premium", subscription_status: "trialing", grandfathered_until: null })
    ).toBe("premium");
  });

  it("falls back to free when a subscription is canceled, even if tier column is stale", () => {
    expect(
      getEffectiveTier({ subscription_tier: "pro", subscription_status: "canceled", grandfathered_until: null })
    ).toBe("free");
  });

  it("grants premium via an unexpired grandfather window with no real subscription", () => {
    expect(getEffectiveTier({ subscription_tier: "free", subscription_status: null, grandfathered_until: FUTURE })).toBe(
      "premium"
    );
  });

  it("ignores an expired grandfather window", () => {
    expect(getEffectiveTier({ subscription_tier: "free", subscription_status: null, grandfathered_until: PAST })).toBe(
      "free"
    );
  });

  it("prefers a real active subscription over grandfathering", () => {
    expect(
      getEffectiveTier({ subscription_tier: "pro", subscription_status: "active", grandfathered_until: FUTURE })
    ).toBe("pro");
  });
});

describe("getStudentCap", () => {
  it("returns 1/3/12 for free/pro/premium", () => {
    expect(getStudentCap({ subscription_tier: "free", subscription_status: null, grandfathered_until: null })).toBe(1);
    expect(getStudentCap({ subscription_tier: "pro", subscription_status: "active", grandfathered_until: null })).toBe(
      3
    );
    expect(
      getStudentCap({ subscription_tier: "premium", subscription_status: "active", grandfathered_until: null })
    ).toBe(12);
  });
});

describe("isRetentionDaysAllowed", () => {
  const free = { subscription_tier: "free" as const, subscription_status: null, grandfathered_until: null };
  const pro = { subscription_tier: "pro" as const, subscription_status: "active" as const, grandfathered_until: null };
  const premium = {
    subscription_tier: "premium" as const,
    subscription_status: "active" as const,
    grandfathered_until: null,
  };

  it("allows only 7 for free", () => {
    expect(isRetentionDaysAllowed(free, 7)).toBe(true);
    expect(isRetentionDaysAllowed(free, 14)).toBe(false);
    expect(isRetentionDaysAllowed(free, null)).toBe(false);
  });

  it("allows 7-14 for pro, not 21/never", () => {
    expect(isRetentionDaysAllowed(pro, 14)).toBe(true);
    expect(isRetentionDaysAllowed(pro, 21)).toBe(false);
    expect(isRetentionDaysAllowed(pro, null)).toBe(false);
  });

  it("allows 7-30 and never for premium", () => {
    expect(isRetentionDaysAllowed(premium, 30)).toBe(true);
    expect(isRetentionDaysAllowed(premium, null)).toBe(true);
  });
});
