import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdFor, type BillingTier, type BillingInterval } from "@/lib/stripe";

const VALID_TIERS: BillingTier[] = ["pro", "premium"];
const VALID_INTERVALS: BillingInterval[] = ["month", "quarter", "year"];

/** Changes tier and/or interval on an EXISTING subscription -- unlike
 * /api/billing/checkout, which always creates a brand-new one. That
 * distinction matters: a real subscriber clicking "Subscribe" on a
 * different plan would otherwise end up with two subscriptions billing
 * in parallel. Stripe prorates the difference onto the customer's next
 * invoice by default (create_prorations). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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

  const { data: profile } = await supabase
    .from("school_profiles")
    .select("stripe_subscription_id, subscription_status, subscription_tier, billing_interval")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !profile?.stripe_subscription_id ||
    (profile.subscription_status !== "active" && profile.subscription_status !== "trialing")
  ) {
    return NextResponse.json(
      { error: "No active subscription to change -- subscribe to a plan first." },
      { status: 400 }
    );
  }

  if (profile.subscription_tier === tier && profile.billing_interval === interval) {
    return NextResponse.json({ error: "You're already on this plan." }, { status: 400 });
  }

  const stripe = getStripe();
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
  } catch (err) {
    console.error("Failed to retrieve subscription for plan change:", err);
    return NextResponse.json({ error: "Couldn't look up your subscription -- try again in a moment." }, { status: 500 });
  }
  const item = subscription.items.data[0];
  if (!item) {
    return NextResponse.json({ error: "Couldn't find your subscription's billing item." }, { status: 500 });
  }

  try {
    await stripe.subscriptions.update(profile.stripe_subscription_id, {
      items: [{ id: item.id, price: priceId }],
      // always_invoice charges the prorated difference immediately, rather
      // than create_prorations' default of deferring it to the next
      // scheduled invoice -- with a deferred charge, a customer could
      // upgrade for instant access to a higher tier, then switch back down
      // before that invoice is ever generated, getting the upgrade for
      // free. error_if_incomplete makes a failed charge reject the whole
      // plan change instead of granting the new tier on an unpaid promise.
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      // Switching plans is a clear signal to keep the subscription going --
      // clear any pending cancellation (set via the Portal's cancel flow)
      // so the account doesn't end up on the new plan but still scheduled
      // to lapse.
      cancel_at_period_end: false,
      cancel_at: null,
      // Ensures tax is recalculated on the new price too, and brings it
      // onto any subscription that predates Stripe Tax being enabled here.
      automatic_tax: { enabled: true },
    });
  } catch (err) {
    console.error("Failed to update subscription for plan change:", err);
    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: "Your payment method couldn't be charged for this change -- update it via Manage billing and try again." },
        { status: 402 }
      );
    }
    throw err;
  }

  return NextResponse.json({ success: true });
}
