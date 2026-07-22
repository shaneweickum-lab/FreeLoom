"use client";

import { useState } from "react";
import { getEffectiveTier, STUDENT_CAP, MAX_RETENTION_DAYS } from "@/lib/billing/tier";
import type { SubscriptionTier } from "@/lib/billing/tier";
import type { SchoolProfile } from "@/lib/types";

type Interval = "month" | "quarter" | "year";

const INTERVAL_LABEL: Record<Interval, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };

const PLANS: {
  tier: SubscriptionTier;
  name: string;
  prices: Record<Interval, number> | null;
}[] = [
  { tier: "free", name: "Free", prices: null },
  { tier: "pro", name: "Pro", prices: { month: 14.99, quarter: 40.47, year: 149.3 } },
  { tier: "premium", name: "Premium", prices: { month: 39.99, quarter: 101.97, year: 374.31 } },
];

function featuresFor(tier: SubscriptionTier): string[] {
  const cap = STUDENT_CAP[tier];
  const maxDays = MAX_RETENTION_DAYS[tier];
  return [
    `${cap} student profile${cap === 1 ? "" : "s"}`,
    tier === "free"
      ? "Message threads auto-delete after 7 days (fixed)"
      : `Choose message auto-delete, up to ${maxDays} days${tier === "premium" ? " (or never)" : ""}`,
    tier === "free" ? "Benny assistant not included" : "Benny assistant-mode chat",
    tier === "free" ? "No admin read-only support access" : "Admin read-only support access",
  ];
}

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
 * three with uniformly. */
export default function BillingTab({ initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [error, setError] = useState("");

  const tier = getEffectiveTier({
    subscription_tier: initialProfile?.subscription_tier ?? "free",
    subscription_status: initialProfile?.subscription_status ?? null,
    grandfathered_until: initialProfile?.grandfathered_until ?? null,
  });
  const grandfathered =
    tier === "premium" &&
    initialProfile?.subscription_status !== "active" &&
    initialProfile?.subscription_status !== "trialing" &&
    !!initialProfile?.grandfathered_until;
  // Set via the Customer Portal's cancel flow -- Stripe keeps the
  // subscription (and this account's tier gates) active through the end
  // of the period already paid for, it just won't renew afterward.
  const cancelPending = !!initialProfile?.cancel_at_period_end && !!initialProfile?.current_period_end;

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
        {PLANS.map((plan) => {
          const isCurrent = tier === plan.tier;
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
                  {plan.prices ? `$${plan.prices[billingInterval].toFixed(2)}` : "$0"}
                  {plan.prices && (
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
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.tier as "pro" | "premium")}
                    disabled={loadingTier !== null}
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
