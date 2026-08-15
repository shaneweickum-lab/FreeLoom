import { beforeEach, describe, expect, it, vi } from "vitest";

const retrieveMock = vi.fn();
const getStripeMock = vi.fn(() => ({ prices: { retrieve: retrieveMock } }));
const priceIdForMock = vi.fn((tier: string, interval: string): string | undefined => `price_${tier}_${interval}`);

vi.mock("@/lib/stripe", () => ({
  getStripe: () => getStripeMock(),
  priceIdFor: (tier: string, interval: string) => priceIdForMock(tier, interval),
}));

import { fetchPriceTable } from "./prices";

describe("fetchPriceTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    priceIdForMock.mockImplementation((tier: string, interval: string) => `price_${tier}_${interval}`);
  });

  it("fetches all 6 (tier, interval) prices and converts cents to dollars", async () => {
    retrieveMock.mockImplementation(async (priceId: string) => ({
      id: priceId,
      unit_amount: priceId.includes("pro") ? 1499 : 3999,
    }));
    const table = await fetchPriceTable();
    expect(table.pro.month).toBe(14.99);
    expect(table.premium.month).toBe(39.99);
    expect(retrieveMock).toHaveBeenCalledTimes(6);
  });

  it("leaves a price null when priceIdFor has no configured Price ID for that pair", async () => {
    priceIdForMock.mockImplementation((tier: string, interval: string) => (tier === "pro" && interval === "year" ? undefined : `price_${tier}_${interval}`));
    retrieveMock.mockResolvedValue({ unit_amount: 1000 });
    const table = await fetchPriceTable();
    expect(table.pro.year).toBeNull();
    // Only the 5 configured pairs should have actually been retrieved.
    expect(retrieveMock).toHaveBeenCalledTimes(5);
  });

  it("degrades a single failed Stripe lookup to null instead of throwing for the whole table", async () => {
    retrieveMock.mockImplementation(async (priceId: string) => {
      if (priceId === "price_pro_month") throw new Error("Stripe API unreachable");
      return { unit_amount: 2000 };
    });
    const table = await fetchPriceTable();
    expect(table.pro.month).toBeNull();
    expect(table.pro.quarter).toBe(20);
  });

  it("leaves a price null when Stripe returns a non-numeric unit_amount", async () => {
    retrieveMock.mockResolvedValue({ unit_amount: null });
    const table = await fetchPriceTable();
    expect(table.pro.month).toBeNull();
  });

  it("degrades to an all-null table when getStripe() itself throws (e.g. no secret key configured)", async () => {
    getStripeMock.mockImplementation(() => {
      throw new Error("STRIPE_SECRET_KEY is not set");
    });
    const table = await fetchPriceTable();
    expect(table).toEqual({
      pro: { month: null, quarter: null, year: null },
      premium: { month: null, quarter: null, year: null },
    });
  });
});
