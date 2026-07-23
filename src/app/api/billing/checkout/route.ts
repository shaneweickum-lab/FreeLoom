import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdFor, type BillingTier, type BillingInterval } from "@/lib/stripe";
import { APP_URL } from "@/lib/appUrl";
import { isRateLimited } from "@/lib/rateLimit";

const VALID_TIERS: BillingTier[] = ["pro", "premium"];
const VALID_INTERVALS: BillingInterval[] = ["month", "quarter", "year"];

/** Only accepts a same-origin relative path (starting with "/", not "//")
 * -- these get concatenated onto APP_URL below, so anything else (an
 * absolute URL, a protocol-relative "//host") is rejected rather than
 * risking an open redirect through Stripe's success/cancel flow. */
function safeRelativePath(path: unknown, fallback: string): string {
  if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) return path;
  return fallback;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Signed in, so a random script can't hit this at scale the way it could
  // an anonymous route -- but it still calls out to Stripe multiple times
  // per request, so a buggy client-side retry loop or a compromised
  // session shouldn't be able to hammer it unbounded.
  if (isRateLimited(`checkout:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const tier = body?.tier as BillingTier;
  const interval = body?.interval as BillingInterval;
  if (!VALID_TIERS.includes(tier) || !VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: "tier and interval are required." }, { status: 400 });
  }

  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    console.error(`No Stripe Price configured for ${tier}/${interval}`);
    return NextResponse.json({ error: "That plan isn't available right now." }, { status: 500 });
  }

  // Lets a caller (e.g. the onboarding wizard) land the customer somewhere
  // other than Settings after Checkout -- defaults preserve the original
  // behavior for every existing call site.
  const successPath = safeRelativePath(body?.successPath, "/settings");
  const cancelPath = safeRelativePath(body?.cancelPath, "/settings");

  const { data: profile } = await supabase
    .from("school_profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Reuse an existing Stripe Customer if this account already has one
  // (e.g. a prior canceled subscription) -- creating a fresh one every
  // checkout would orphan payment-method history and confuse the
  // Customer Portal, which is keyed off a single customer per account.
  // A stored ID can still be stale (e.g. STRIPE_SECRET_KEY pointed at a
  // different Stripe account when it was created, or the customer was
  // deleted directly in Stripe), so verify it actually resolves before
  // trusting it -- customer IDs aren't portable across accounts.
  const stripe = getStripe();
  let customerId = profile?.stripe_customer_id ?? null;

  // Everything below is a live call to Stripe's API -- a transient network
  // error or Stripe-side outage must come back as a clean 500 the client
  // can show a real message for, not an unhandled exception.
  try {
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if (existing.deleted) customerId = null;
      } catch (err) {
        if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
          customerId = null;
        } else {
          throw err;
        }
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      const { error } = await supabase.from("school_profiles").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error("Failed to save new Stripe customer id to school_profiles:", error);
    }

    // Authoritative guard against ever ending up with two live subscriptions
    // on the same account -- checked live against Stripe (not just
    // school_profiles' cached subscription_status) since that column could
    // in principle be stale if a webhook delivery lagged or failed. Blocks
    // on anything short of a fully terminal status, not just active/
    // trialing -- a past_due, unpaid, or incomplete subscription is still a
    // real one that a second Checkout would run alongside rather than fix;
    // those need Manage billing (to update the payment method) instead. A
    // real subscriber changing tier/interval should go through
    // /api/billing/change-plan, which updates this same subscription in
    // place rather than starting a second one here.
    const existingSubscriptions = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
    const hasBlockingSubscription = existingSubscriptions.data.some(
      (s) => s.status !== "canceled" && s.status !== "incomplete_expired"
    );
    if (hasBlockingSubscription) {
      return NextResponse.json(
        { error: "You already have an active subscription -- use Switch plan or Manage billing instead." },
        { status: 400 }
      );
    }

    // Closes the double-tab race the subscription check above can't: two
    // tabs can both pass hasBlockingSubscription (neither has completed
    // payment yet, so Stripe has no Subscription object for either one) and
    // both go on to create a session, ending in two live subscriptions if
    // both get paid. Checked live against Stripe's own open Checkout
    // Sessions for this customer, same "authoritative, not just our cached
    // state" approach as the subscription check above.
    //
    // Rather than just blocking on a match, expire it and proceed -- a
    // Checkout Session stays "open" for up to 24h even after a declined
    // card or an abandoned tab, and the user starting a new checkout here
    // is the clearest possible signal the old one is dead, not a second
    // concurrent attempt. This still closes the actual race: a genuinely
    // still-open second tab would find its own session invalidated the
    // moment it tries to complete, so at most one checkout can ever
    // succeed, without permanently locking a normal retry out for a day.
    const openSessions = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 1 });
    if (openSessions.data.length > 0) {
      await stripe.checkout.sessions.expire(openSessions.data[0].id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}${successPath}?billing=success`,
      cancel_url: `${APP_URL}${cancelPath}?billing=canceled`,
      // Belt-and-suspenders alongside customer.metadata -- the webhook reads
      // whichever of these is present to map a Stripe event back to the
      // Supabase account, since some events carry the subscription/customer
      // but not the originating Checkout Session.
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
      // Stripe Tax calculates and collects the right sales tax/VAT per
      // customer location -- requires a billing address to determine
      // jurisdiction (collected here since neither of FreeLoom's own
      // customer-creation calls set one), and tax registrations to be
      // configured in the Stripe Dashboard for wherever there's nexus
      // before it actually charges anything (a Dashboard-only step, not
      // something this code can set up).
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
    });

    if (!session.url) {
      return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return NextResponse.json({ error: "Couldn't start checkout -- try again in a moment." }, { status: 500 });
  }
}
