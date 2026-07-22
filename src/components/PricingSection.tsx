"use client";

import { useState } from "react";
import Link from "next/link";
import { featuresFor, PLAN_NAMES, type SubscriptionTier } from "@/lib/billing/tier";
import type { PriceTable } from "@/lib/billing/prices";

type Interval = "month" | "quarter" | "year";
const INTERVAL_LABEL: Record<Interval, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };
const PLAN_ORDER: SubscriptionTier[] = ["free", "pro", "premium"];

/** % cheaper `interval` is per month than paying monthly, for one paid
 * tier -- computed live from the same Stripe-sourced PriceTable the
 * displayed prices come from, never a hardcoded percentage, so it can't
 * drift out of sync with what Checkout actually charges. */
function discountPct(prices: PriceTable, tier: "pro" | "premium", interval: Interval): number | null {
  const monthly = prices[tier]?.month;
  const price = prices[tier]?.[interval];
  if (interval === "month" || monthly == null || price == null || monthly <= 0) return null;
  const equivalentMonthly = price / (interval === "quarter" ? 3 : 12);
  const pct = Math.round((1 - equivalentMonthly / monthly) * 100);
  return pct > 0 ? pct : null;
}

export default function PricingSection({ prices }: { prices: PriceTable }) {
  const [interval, setInterval] = useState<Interval>("month");
  // The pill's own badges use Pro's discount as the headline number (Pro is
  // the highlighted plan) -- each card below always shows its own real,
  // per-tier price and savings, so nothing here can mislead even where
  // Premium's actual discount differs from Pro's.
  const pillDiscount: Record<Interval, number | null> = {
    month: null,
    quarter: discountPct(prices, "pro", "quarter"),
    year: discountPct(prices, "pro", "year"),
  };

  return (
    <section id="pricing" className="scroll-mt-24 flex flex-col gap-8">
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold mb-2">Plans that grow with your family</h2>
        <p className="text-muted text-sm max-w-xl mx-auto">
          Start free. Upgrade whenever you need more students or a longer message history --
          switch to quarterly or yearly billing any time for a discount.
        </p>
      </div>

      <div role="group" aria-label="Billing interval" className="flex items-center gap-1 rounded-lg border border-navy-line p-1 w-fit mx-auto">
        {(["month", "quarter", "year"] as Interval[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setInterval(opt)}
            aria-pressed={interval === opt}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              interval === opt ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
            }`}
          >
            {INTERVAL_LABEL[opt]}
            {pillDiscount[opt] != null && (
              <span className="rounded-full bg-gold/20 px-1.5 py-0.5 text-[10px] font-mono text-gold">
                −{pillDiscount[opt]}%
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {PLAN_ORDER.map((tier) => {
          const price = tier === "free" ? 0 : prices[tier as "pro" | "premium"]?.[interval] ?? null;
          const savePct = tier === "free" ? null : discountPct(prices, tier as "pro" | "premium", interval);
          const highlighted = tier === "pro";
          return (
            <div
              key={tier}
              className={`rounded-lg border p-6 flex flex-col gap-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${
                highlighted ? "border-gold/50 bg-gold/5 shadow-sm" : "border-navy-line bg-navy-soft"
              }`}
            >
              <div>
                <h3 className="font-serif text-lg font-bold">{PLAN_NAMES[tier]}</h3>
                <p className="text-3xl font-bold mt-1">
                  {price === null ? "—" : `$${price.toFixed(2)}`}
                  {tier !== "free" && price !== null && (
                    <span className="text-sm font-normal text-muted">/{interval === "month" ? "mo" : interval}</span>
                  )}
                </p>
                {savePct != null && <p className="text-xs text-gold mt-1">Save {savePct}% vs. monthly</p>}
              </div>
              <ul className="flex flex-col gap-1.5 text-sm text-muted flex-1">
                {featuresFor(tier).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href="/login"
                className={
                  highlighted
                    ? "rounded-md bg-gold px-4 py-2 text-center text-sm font-medium text-ink shadow-sm hover:bg-gold-hover transition-colors"
                    : "rounded-md border border-navy-line px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-surface-hover transition-colors"
                }
              >
                Get started
              </Link>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted">
        Charges are final (no refunds) -- cancel any time and keep access through the end of your paid period. See
        our{" "}
        <Link href="/terms" className="text-gold hover:underline">
          Terms of Service
        </Link>{" "}
        for the full billing terms.
      </p>
    </section>
  );
}
