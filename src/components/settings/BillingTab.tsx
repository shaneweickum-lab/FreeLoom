"use client";

import { useState } from "react";
import { getEffectiveTier, featuresFor, PLAN_NAMES } from "@/lib/billing/tier";
import type { SubscriptionTier } from "@/lib/billing/tier";
import type { PriceTable } from "@/lib/billing/prices";
import type { SchoolProfile } from "@/lib/types";

type Interval = "month" | "quarter" | "year";

const INTERVAL_LABEL: Record<Interval, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };

const PLAN_META: { tier: SubscriptionTier; name: string }[] = [
  { tier: "free", name: PLAN_NAMES.free },
  { tier: "pro", name: PLAN_NAMES.pro },
  { tier: "premium", name: PLAN_NAMES.premium },
];

function daysRemaining(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** userId isn't used here -- every billing action (checkout/portal) infers
 * the caller from the server-side session, not a client-supplied id -- but
 * the prop is kept in the signature to match AccountTab/NotificationsTab's
 * shared {userId, initialProfile} convention SettingsTabs.tsx calls all
 * three with uniformly. `prices` is fetched live from Stripe server-side
 * (src/lib/billing/prices.ts) rather than hardcoded here, so this card can
 * never show a different number than what Checkout actually charges. */
export default function BillingTab({
  initialProfile,
  isAdmin,
  prices,
}: {
  userId: string;
  initialProfile: SchoolProfile | null;
  isAdmin: boolean;
  prices: PriceTable;
}) {
  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [error, setError] = useState("");

  const tier = getEffectiveTier({
    subscription_tier: initialProfile?.subscription_tier ?? "free",
    subscription_status: initialProfile?.subscription_status ?? null,
    grandfathered_until: initialProfile?.grandfathered_until ?? null,
    current_period_end: initialProfile?.current_period_end ?? null,
    isAdmin,
  });
  const grandfathered =
    !isAdmin &&
    tier === "premium" &&
    initialProfile?.subscription_status !== "active" &&
    initialProfile?.subscription_status !== "trialing" &&
    !!initialProfile?.grandfathered_until;
  // Set via the Customer Portal's cancel flow -- Stripe keeps the
  // subscription (and this account's tier gates) active through the end
  // of the period already paid for, it just won't renew afterward.
  const cancelPending = !!initialProfile?.cancel_at_period_end && !!initialProfile?.current_period_end;
  // A real, currently-billing subscription -- distinct from `tier` above,
  // which also counts a temporary grandfather window as "premium." Only a
  // real subscription can conflict with a new one, so grandfathered/free
  // accounts should still see every paid plan as subscribable.
  const realSubscribedTier =
    initialProfile?.stripe_subscription_id &&
    (initialProfile?.subscription_status === "active" || initialProfile?.subscription_status === "trialing")
      ? initialProfile.subscription_tier
      : null;

  async function handleSubscribe(planTier: "pro" | "premium") {
    setLoadingTier(planTier);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: planTier, interval: billingInterval }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start checkout.");
        setLoadingTier(null);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Couldn't start checkout -- please try again.");
      setLoadingTier(null);
    }
  }

  async function handleChangePlan(planTier: "pro" | "premium", planName: string) {
    const confirmed = window.confirm(
      `Switch to ${planName} (${INTERVAL_LABEL[billingInterval]})? Stripe will prorate the difference on your next invoice.`
    );
    if (!confirmed) return;

    setLoadingTier(planTier);
    setError("");
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: planTier, interval: billingInterval }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't switch plans.");
        setLoadingTier(null);
        return;
      }
      // The webhook updates school_profiles asynchronously once Stripe
      // processes the change -- give it a moment before reloading so this
      // page's server-fetched profile reflects the new plan, not the
      // stale one from before the switch.
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setError("Couldn't switch plans -- please try again.");
      setLoadingTier(null);
    }
  }

  async function handleManageBilling() {
    setLoadingPortal(true);
    setError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't open billing management.");
        setLoadingPortal(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Couldn't open billing management -- please try again.");
      setLoadingPortal(false);
    }
  }

  if (isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-navy-line p-4 flex flex-col gap-2">
          <h2 className="font-serif text-lg font-bold">Billing</h2>
          <p className="text-sm text-muted">
            Admin account -- the entire platform is available to you regardless of billing status. No subscription
            needed.
          </p>
          {initialProfile?.stripe_customer_id && (
            <button onClick={handleManageBilling} disabled={loadingPortal} className="btn-secondary w-fit text-sm mt-1">
              {loadingPortal ? "Opening…" : "Manage billing"}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-navy-line p-4 flex flex-col gap-2">
        <h2 className="font-serif text-lg font-bold">Billing</h2>
        <p className="text-sm text-muted">
          Current plan: <span className="font-medium text-foreground capitalize">{tier}</span>
          {initialProfile?.billing_interval && ` (${INTERVAL_LABEL[initialProfile.billing_interval]})`}
        </p>
        {grandfathered && initialProfile?.grandfathered_until && (
          <p className="text-xs text-gold">
            You have full Premium access for {daysRemaining(initialProfile.grandfathered_until)} more day
            {daysRemaining(initialProfile.grandfathered_until) === 1 ? "" : "s"} while paid plans roll out -- pick a
            plan below to keep it afterward.
          </p>
        )}
        {cancelPending && initialProfile?.current_period_end && (
          <p className="text-xs text-gold">
            Your {tier} plan cancels on {formatDate(initialProfile.current_period_end)} -- resubscribe anytime before
            then to keep it.
          </p>
        )}
        {initialProfile?.stripe_customer_id && (
          <button onClick={handleManageBilling} disabled={loadingPortal} className="btn-secondary w-fit text-sm mt-1">
            {loadingPortal ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-navy-line p-1 w-fit">
        {(["month", "quarter", "year"] as Interval[]).map((opt) => (
          <button
            key={opt}
            onClick={() => setBillingInterval(opt)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              billingInterval === opt ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
            }`}
          >
            {INTERVAL_LABEL[opt]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLAN_META.map((plan) => {
          const price = plan.tier === "free" ? 0 : prices[plan.tier as "pro" | "premium"]?.[billingInterval] ?? null;
          // Free has no interval to match against; a paid plan is only
          // "current" when both the tier AND the toggled interval match
          // the real subscription (or there's no real interval yet, i.e.
          // a grandfathered account with no Stripe subscription at all).
          const isCurrent =
            tier === plan.tier &&
            (plan.tier === "free" || !initialProfile?.billing_interval || initialProfile.billing_interval === billingInterval);
          // A real subscriber switching to any other paid plan or interval
          // updates their existing subscription (with proration) instead
          // of going through Checkout, which would always start a second,
          // parallel subscription.
          const isPlanChange = !!realSubscribedTier && plan.tier !== "free" && !isCurrent;
          return (
            <div
              key={plan.tier}
              className={`rounded-lg border p-4 flex flex-col gap-3 ${
                isCurrent ? "border-gold/50 bg-gold/5" : "border-navy-line"
              }`}
            >
              <div>
                <h3 className="font-serif text-base font-bold">{plan.name}</h3>
                <p className="text-2xl font-bold mt-1">
                  {price === null ? "—" : `$${price.toFixed(2)}`}
                  {plan.tier !== "free" && price !== null && (
                    <span className="text-xs font-normal text-muted">
                      {" "}
                      /{billingInterval === "month" ? "mo" : billingInterval}
                    </span>
                  )}
                </p>
              </div>
              <ul className="flex flex-col gap-1 text-xs text-muted flex-1">
                {featuresFor(plan.tier).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {plan.tier !== "free" &&
                (isCurrent ? (
                  <span className="text-xs text-gold font-medium">Current plan</span>
                ) : isPlanChange ? (
                  <button
                    onClick={() => handleChangePlan(plan.tier as "pro" | "premium", plan.name)}
                    disabled={loadingTier !== null || price === null}
                    className="btn-secondary text-sm w-fit disabled:opacity-50"
                  >
                    {loadingTier === plan.tier ? "Updating…" : "Switch plan"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.tier as "pro" | "premium")}
                    disabled={loadingTier !== null || price === null}
                    className="btn-primary text-sm w-fit disabled:opacity-50"
                  >
                    {loadingTier === plan.tier ? "Redirecting…" : "Subscribe"}
                  </button>
                ))}
              {plan.tier === "free" && isCurrent && <span className="text-xs text-gold font-medium">Current plan</span>}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-muted/70 text-[11px]">
        PWA/mobile app access and Benny usage limits are on the way -- not enforced yet.
      </p>
    </div>
  );
}
