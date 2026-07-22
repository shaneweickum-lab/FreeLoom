import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, tierAndIntervalForPrice } from "@/lib/stripe";

/** No authenticated user here -- Stripe calls this directly, verified via
 * HMAC signature rather than a session cookie or bearer secret (same "no
 * authenticated caller, verify via a secret" shape as
 * /api/cron/cleanup-threads, just a different verification mechanism).
 * Uses createAdminClient() to write school_profiles since there's no RLS
 * session to act as. */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const stripe = getStripe();
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      if (!userId || !session.subscription) {
        console.error("checkout.session.completed missing supabase_user_id or subscription", {
          sessionId: session.id,
        });
        break;
      }

      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      await syncSubscription(adminClient, userId, subscription);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(adminClient, subscription);
      if (!userId) {
        console.error("customer.subscription.updated: couldn't resolve a Supabase user", {
          subscriptionId: subscription.id,
        });
        break;
      }
      await syncSubscription(adminClient, userId, subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(adminClient, subscription);
      if (!userId) {
        console.error("customer.subscription.deleted: couldn't resolve a Supabase user", {
          subscriptionId: subscription.id,
        });
        break;
      }
      const { error } = await adminClient
        .from("school_profiles")
        .upsert({ user_id: userId, subscription_tier: "free", subscription_status: "canceled" });
      if (error) console.error("Failed to reset school_profiles to free on cancellation:", error);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;
      const { data: profile } = await adminClient
        .from("school_profiles")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (!profile) break;
      // Best-effort, in-app only -- Stripe's own Smart Retries handle the
      // actual recovery attempts, this just lets the parent know to check.
      const { error } = await adminClient.from("notifications").insert({
        user_id: profile.user_id,
        type: "announcement",
        title: "A payment on your FreeLoom plan failed",
        body: "Update your payment method in Settings > Billing to keep your plan active.",
        link_path: "/settings",
      });
      if (error) console.error("Failed to insert payment-failed notification:", error);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}

/** subscription.metadata is set at checkout time (subscription_data.metadata
 * in /api/billing/checkout) and persists for the subscription's lifetime,
 * including portal-initiated changes -- but falls back to a customer-id
 * lookup in case an older/different-origin subscription lacks it. */
async function resolveUserId(
  adminClient: ReturnType<typeof createAdminClient>,
  subscription: Stripe.Subscription
): Promise<string | null> {
  if (subscription.metadata?.supabase_user_id) return subscription.metadata.supabase_user_id;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const { data: profile } = await adminClient
    .from("school_profiles")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return profile?.user_id ?? null;
}

async function syncSubscription(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  subscription: Stripe.Subscription
) {
  const item = subscription.items.data[0];
  const mapped = item ? tierAndIntervalForPrice(item.price.id) : null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { error } = await adminClient.from("school_profiles").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_tier: mapped?.tier ?? "free",
    subscription_status: subscription.status,
    billing_interval: mapped?.interval ?? null,
    current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("Failed to sync school_profiles from Stripe subscription:", error);
}
