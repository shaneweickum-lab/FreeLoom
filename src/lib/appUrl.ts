/** Canonical production URL for building absolute links -- Stripe Checkout/
 * Portal redirects, email notification links. Centralized so a domain
 * change only needs updating in one place (and an env var override,
 * NEXT_PUBLIC_APP_URL, if a future preview/staging deploy ever needs a
 * different value) instead of once per call site. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.freeloom.io";
