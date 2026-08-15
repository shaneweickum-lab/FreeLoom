import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { priceIdFor, tierAndIntervalForPrice } from "./stripe";

const PRICE_ENV_VARS = [
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_QUARTERLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "STRIPE_PRICE_PREMIUM_QUARTERLY",
  "STRIPE_PRICE_PREMIUM_YEARLY",
];

describe("priceIdFor / tierAndIntervalForPrice", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of PRICE_ENV_VARS) originalEnv[key] = process.env[key];
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month";
    process.env.STRIPE_PRICE_PRO_QUARTERLY = "price_pro_quarter";
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_year";
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_premium_month";
    process.env.STRIPE_PRICE_PREMIUM_QUARTERLY = "price_premium_quarter";
    process.env.STRIPE_PRICE_PREMIUM_YEARLY = "price_premium_year";
  });

  afterEach(() => {
    for (const key of PRICE_ENV_VARS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("maps every (tier, interval) pair to its own env var", () => {
    expect(priceIdFor("pro", "month")).toBe("price_pro_month");
    expect(priceIdFor("pro", "quarter")).toBe("price_pro_quarter");
    expect(priceIdFor("pro", "year")).toBe("price_pro_year");
    expect(priceIdFor("premium", "month")).toBe("price_premium_month");
    expect(priceIdFor("premium", "quarter")).toBe("price_premium_quarter");
    expect(priceIdFor("premium", "year")).toBe("price_premium_year");
  });

  it("returns undefined when the env var for that pair isn't set", () => {
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    expect(priceIdFor("pro", "month")).toBeUndefined();
  });

  it("reverse-looks-up the (tier, interval) pair for a known Price ID", () => {
    expect(tierAndIntervalForPrice("price_premium_quarter")).toEqual({ tier: "premium", interval: "quarter" });
  });

  it("returns null for a Price ID that doesn't match any of the 6 known ones", () => {
    expect(tierAndIntervalForPrice("price_unknown")).toBeNull();
  });
});
