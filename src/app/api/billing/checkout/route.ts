import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdFor, type BillingTier, type BillingInterval } from "@/lib/stripe";

const APP_URL = "https://freeloom-bice.vercel.app";

const VALID_TIERS: BillingTier[] = ["pro", "premium"];
const VALID_INTERVALS: BillingInterval[] = ["month", "quarter", "year"];

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
    await supabase.from("school_profiles").upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/settings?billing=success`,
    cancel_url: `${APP_URL}/settings?billing=canceled`,
    // Belt-and-suspenders alongside customer.metadata -- the webhook reads
    // whichever of these is present to map a Stripe event back to the
    // Supabase account, since some events carry the subscription/customer
    // but not the originating Checkout Session.
    metadata: { supabase_user_id: user.id },
    subscription_data: { metadata: { supabase_user_id: user.id } },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
  }
  return NextResponse.json({ url: session.url });
}
