import Stripe from "stripe";

/** Lazily-constructed, memoized Stripe client -- server-only (uses the
 * secret key), never imported from a "use client" file. Lazy on purpose:
 * a top-level `new Stripe(...)` at module load time throws immediately if
 * STRIPE_SECRET_KEY is unset, which crashes `next build`'s page-data
 * collection step for every route that imports this file (it doesn't need
 * to be *called*, just imported) -- same reason Resend is only ever
 * instantiated inside a function in src/app/api/messages/route.ts, never
 * at module scope. */
let cachedStripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!cachedStripe) cachedStripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return cachedStripe;
}

export type BillingTier = "pro" | "premium";
export type BillingInterval = "month" | "quarter" | "year";

/** Maps a (tier, interval) pair to its Stripe Price ID env var. Six Prices
 * total across two Products ("FreeLoom Pro", "FreeLoom Premium"), created
 * once via the Stripe Dashboard/API at $14.99/$40.47/$149.30 (Pro) and
 * $39.99/$101.97/$374.31 (Premium) for month/quarter/year respectively. */
export function priceIdFor(tier: BillingTier, interval: BillingInterval): string | undefined {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${
    interval === "month" ? "MONTHLY" : interval === "quarter" ? "QUARTERLY" : "YEARLY"
  }`;
  return process.env[key];
}

const TIERS: BillingTier[] = ["pro", "premium"];
const INTERVALS: BillingInterval[] = ["month", "quarter", "year"];

/** Reverse lookup for the webhook handler -- Stripe events carry a Price
 * ID, not our own tier/interval labels, so this checks it against all 6
 * known Price ID env vars. */
export function tierAndIntervalForPrice(priceId: string): { tier: BillingTier; interval: BillingInterval } | null {
  for (const tier of TIERS) {
    for (const interval of INTERVALS) {
      if (priceIdFor(tier, interval) === priceId) return { tier, interval };
    }
  }
  return null;
}
