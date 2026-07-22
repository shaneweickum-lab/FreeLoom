import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, tierAndIntervalForPrice } from "@/lib/stripe";
import { buildPaymentFailedEmail } from "@/lib/email/paymentFailedNotification";
import { APP_URL } from "@/lib/appUrl";

/** Best-effort -- an email failure must never turn a successfully-recorded
 * payment-failed notification into a 500 (Stripe would just retry the
 * whole webhook event pointlessly), same pattern as every other
 * Resend call site in this codebase (messages/announcements routes). */
async function sendPaymentFailedEmail(to: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FreeLoom <onboarding@resend.dev>",
      to,
      subject: "We couldn't process your last payment",
      html: buildPaymentFailedEmail({ appUrl: APP_URL }),
    });
  } catch (err) {
    console.error("Failed to send payment-failed email:", err);
  }
}

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
  // A DB write failure here (as opposed to a business-logic issue like
  // missing metadata, which will never resolve on retry) must NOT be
  // swallowed into a 200 -- returning success would tell Stripe this event
  // is fully handled and it will never retry, permanently desyncing a
  // customer's tier from what they actually paid for. Returning 500
  // instead lets Stripe's own retry schedule (up to 3 days) recover from
  // what's almost always a transient outage.
  let dbWriteFailed = false;

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
      if (!(await syncSubscription(adminClient, userId, subscription))) dbWriteFailed = true;
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
      if (!(await syncSubscription(adminClient, userId, subscription))) dbWriteFailed = true;
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
      const { error } = await adminClient.from("school_profiles").upsert({
        user_id: userId,
        subscription_tier: "free",
        subscription_status: "canceled",
        cancel_at_period_end: false,
      });
      if (error) {
        console.error("Failed to reset school_profiles to free on cancellation:", error);
        dbWriteFailed = true;
      }
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

      // Stripe explicitly documents webhook delivery as at-least-once, not
      // exactly-once -- a redelivered event for the same invoice must not
      // insert a second notification for the same failed payment.
      const { data: existing } = await adminClient
        .from("notifications")
        .select("id")
        .eq("related_id", invoice.id)
        .eq("type", "announcement")
        .maybeSingle();
      if (existing) break;

      // In-app notification is best-effort visibility for someone already
      // logged in; Stripe's own Smart Retries handle the actual recovery
      // attempts. But a parent who ISN'T actively in the app during the
      // grace period would otherwise get no signal at all before silently
      // losing their tier -- so this also emails them directly, using the
      // real Auth email (not the optional profile contact-info field,
      // which may be blank or stale).
      const { error } = await adminClient.from("notifications").insert({
        user_id: profile.user_id,
        type: "announcement",
        title: "A payment on your FreeLoom plan failed",
        body: "Update your payment method in Settings > Billing to keep your plan active.",
        link_path: "/settings",
        related_id: invoice.id,
      });
      if (error) {
        console.error("Failed to insert payment-failed notification:", error);
        dbWriteFailed = true;
      }

      const { data: authUser } = await adminClient.auth.admin.getUserById(profile.user_id);
      if (authUser.user?.email) await sendPaymentFailedEmail(authUser.user.email);
      break;
    }

    default:
      break;
  }

  if (dbWriteFailed) {
    return NextResponse.json({ error: "Failed to persist webhook effects." }, { status: 500 });
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

/** Returns false on a DB write failure so the caller can surface a 500
 * (see the dbWriteFailed comment in POST above) instead of silently
 * treating a failed sync as handled. */
async function syncSubscription(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  subscription: Stripe.Subscription
): Promise<boolean> {
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
    // Stripe has two independent ways to schedule a future cancellation:
    // the classic cancel_at_period_end boolean, and a cancel_at timestamp
    // (what the Customer Portal's default cancel flow actually sets, at
    // least on this API version) -- either one means "this is ending."
    cancel_at_period_end: subscription.cancel_at_period_end || !!subscription.cancel_at,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Failed to sync school_profiles from Stripe subscription:", error);
    return false;
  }
  return true;
}
