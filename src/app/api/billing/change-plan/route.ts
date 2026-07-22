import { NextRequest, NextResponse } from "next/server";
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
  const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
  const item = subscription.items.data[0];
  if (!item) {
    return NextResponse.json({ error: "Couldn't find your subscription's billing item." }, { status: 500 });
  }

  await stripe.subscriptions.update(profile.stripe_subscription_id, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: "create_prorations",
  });

  return NextResponse.json({ success: true });
}
