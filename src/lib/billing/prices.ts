import { getStripe, priceIdFor, type BillingTier, type BillingInterval } from "@/lib/stripe";

export type PriceTable = Record<BillingTier, Record<BillingInterval, number | null>>;

const TIERS: BillingTier[] = ["pro", "premium"];
const INTERVALS: BillingInterval[] = ["month", "quarter", "year"];

/** Fetches the real, currently-live amount for every (tier, interval) Price
 * directly from Stripe, server-side -- so BillingTab.tsx's displayed prices
 * can never drift from what Checkout actually charges. A stale hardcoded
 * number would be a real trust problem: a customer seeing one price on our
 * card and a different (correct) one on Stripe's own hosted Checkout page.
 * A price that fails to fetch (missing env var, deleted Price) comes back
 * null rather than throwing -- BillingTab shows "—" and disables that
 * plan's button instead of taking down the whole tab. */
export async function fetchPriceTable(): Promise<PriceTable> {
  const stripe = getStripe();
  const table: PriceTable = {
    pro: { month: null, quarter: null, year: null },
    premium: { month: null, quarter: null, year: null },
  };

  await Promise.all(
    TIERS.flatMap((tier) =>
      INTERVALS.map(async (interval) => {
        const priceId = priceIdFor(tier, interval);
        if (!priceId) return;
        try {
          const price = await stripe.prices.retrieve(priceId);
          table[tier][interval] = typeof price.unit_amount === "number" ? price.unit_amount / 100 : null;
        } catch (err) {
          console.error(`Failed to fetch Stripe price for ${tier}/${interval}:`, err);
        }
      })
    )
  );

  return table;
}
