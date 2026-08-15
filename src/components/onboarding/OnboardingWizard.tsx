"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import LogoMark from "@/components/LogoMark";
import { createClient } from "@/lib/supabase/client";
import { featuresFor, PLAN_NAMES } from "@/lib/billing/tier";
import type { SubscriptionTier } from "@/lib/billing/tier";
import type { PriceTable } from "@/lib/billing/prices";
import type { SchoolProfile } from "@/lib/types";
import { cardClassName } from "@/components/ui/Card";

const SCHOOLING_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "homeschooling", label: "Homeschooling" },
  { value: "unschooling", label: "Unschooling" },
  { value: "wildschooling", label: "Wildschooling" },
  { value: "alternative_schooling", label: "Alternative Schooling" },
  { value: "private_schooling", label: "Private Schooling" },
] as const;

type Interval = "month" | "quarter" | "year";
const INTERVAL_LABEL: Record<Interval, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };
const PLAN_ORDER: SubscriptionTier[] = ["free", "pro", "premium"];

type Props = { userId: string; initialProfile: SchoolProfile | null; prices: PriceTable };

export default function OnboardingWizard(props: Props) {
  return (
    <Suspense fallback={null}>
      <OnboardingWizardInner {...props} />
    </Suspense>
  );
}

function OnboardingWizardInner({ userId, initialProfile, prices }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A profile that already has a parent name set means this parent has
  // been through (or skipped past) this step before -- e.g. they refreshed
  // mid-wizard, or came back after canceling Checkout -- so land them
  // straight on the plan step instead of asking again.
  const [step, setStep] = useState<"profile" | "plan">(initialProfile?.parent_name ? "plan" : "profile");
  const [parentName, setParentName] = useState(initialProfile?.parent_name ?? "");
  const [state, setState] = useState(initialProfile?.state ?? "");
  const [schoolingType, setSchoolingType] = useState(initialProfile?.schooling_type ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [error, setError] = useState("");

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    const supabase = createClient();
    const { error } = await supabase.from("school_profiles").upsert({
      user_id: userId,
      parent_name: parentName || null,
      state: state || null,
      schooling_type: schoolingType || null,
      updated_at: new Date().toISOString(),
    });
    setSavingProfile(false);
    // A failed upsert must not silently advance to the plan step -- that
    // would tell the parent their info was saved when it wasn't.
    if (error) {
      setProfileError("Couldn't save -- try again.");
      return;
    }
    setStep("plan");
  }

  async function handleChoosePlan(tier: SubscriptionTier) {
    if (tier === "free") {
      router.push("/dashboard");
      return;
    }
    setLoadingTier(tier);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          interval: billingInterval,
          successPath: "/dashboard",
          cancelPath: "/onboarding",
        }),
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

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <Link href="/" className="inline-flex mb-4">
          <LogoMark size={48} />
        </Link>
        <p className="text-xs font-mono uppercase tracking-wide text-muted mb-1">
          Step {step === "profile" ? "1" : "2"} of 2
        </p>
        <h1 className="text-2xl font-bold font-serif">
          {step === "profile" ? "Tell us a bit about your family" : "Choose your plan"}
        </h1>
        <p className="text-muted text-sm mt-2">
          {step === "profile"
            ? "This helps FreeLoom send announcements that actually apply to you."
            : "Start free, or pick a paid plan now -- you can always change this later in Settings."}
        </p>
      </div>

      {step === "profile" ? (
        <form onSubmit={handleProfileSubmit} className={`flex flex-col gap-4 ${cardClassName({ padding: "lg" })}`}>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Your name</span>
            <input className="input" value={parentName} onChange={(e) => setParentName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">State</span>
            <input
              className="input"
              placeholder="e.g. CA, TX, NY"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">How your family learns</span>
            <select
              className="input"
              value={schoolingType}
              onChange={(e) => setSchoolingType(e.target.value as typeof schoolingType)}
            >
              {SCHOOLING_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Continue"}
          </button>
          {profileError && <p className="text-xs text-red-400 text-center">{profileError}</p>}
        </form>
      ) : (
        <div className="flex flex-col gap-6">
          {searchParams.get("billing") === "canceled" && (
            <p className="text-sm text-gold text-center">
              Checkout was canceled -- pick a plan below whenever you&apos;re ready, or continue with Free.
            </p>
          )}

          <div role="group" aria-label="Billing interval" className="flex items-center gap-1 rounded-lg border border-navy-line p-1 w-fit mx-auto">
            {(["month", "quarter", "year"] as Interval[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setBillingInterval(opt)}
                aria-pressed={billingInterval === opt}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  billingInterval === opt ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
                }`}
              >
                {INTERVAL_LABEL[opt]}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {PLAN_ORDER.map((tier) => {
              const price = tier === "free" ? 0 : prices[tier as "pro" | "premium"]?.[billingInterval] ?? null;
              return (
                <div
                  key={tier}
                  className={`rounded-lg border p-4 flex flex-col gap-3 ${
                    tier === "pro" ? "border-gold/50 bg-gold/5" : "border-border bg-surface"
                  }`}
                >
                  <div>
                    <h3 className="font-serif text-base font-bold">{PLAN_NAMES[tier]}</h3>
                    <p className="text-2xl font-bold mt-1">
                      {price === null ? "—" : `$${price.toFixed(2)}`}
                      {tier !== "free" && price !== null && (
                        <span className="text-xs font-normal text-muted">
                          {" "}
                          /{billingInterval === "month" ? "mo" : billingInterval}
                        </span>
                      )}
                    </p>
                  </div>
                  <ul className="flex flex-col gap-1 text-xs text-muted flex-1">
                    {featuresFor(tier).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleChoosePlan(tier)}
                    disabled={loadingTier !== null || (tier !== "free" && price === null)}
                    className={`text-sm w-fit disabled:opacity-50 ${tier === "free" ? "btn-secondary" : "btn-primary"}`}
                  >
                    {loadingTier === tier ? "Redirecting…" : tier === "free" ? "Continue with Free" : "Subscribe"}
                  </button>
                </div>
              );
            })}
          </div>

          {error && <p className="text-xs text-red-400 text-center">{error}</p>}

          <p className="text-center text-xs text-muted">
            Charges are final (no refunds) -- cancel any time and keep access through the end of your paid period.
            See our{" "}
            <Link href="/terms" className="text-gold hover:underline">
              Terms of Service
            </Link>{" "}
            for the full billing terms.
          </p>
        </div>
      )}
    </div>
  );
}
