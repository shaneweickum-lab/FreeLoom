"use client";

import { useState } from "react";
import { usePlan } from "@/lib/planContext";
import { PLAN_LIMITS, PLAN_ORDER } from "@/lib/plans";
import type { PlanId } from "@/lib/types";

export default function BillingPage() {
  const { summary, loading, metric, setMetric, switchPlan } = usePlan();
  const [switching, setSwitching] = useState<PlanId | null>(null);

  async function handleSwitch(plan: PlanId) {
    setSwitching(plan);
    await switchPlan(plan);
    setSwitching(null);
  }

  if (loading || !summary) {
    return <p className="text-muted text-sm">Loading…</p>;
  }

  const totalTokens = summary.inputTokensUsed + summary.outputTokensUsed;
  const pct = Math.min(100, Math.round((summary.actionsUsed / summary.monthlyActions) * 100));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Plan &amp; usage</h1>
        <p className="text-muted text-sm">
          See how much of this month&apos;s assistant usage you&apos;ve used and manage your plan. No payment is
          collected yet — plan changes here are free during this preview.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 max-w-lg flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">This month&apos;s usage</h2>
          <div className="flex text-xs rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setMetric("actions")}
              className={`px-2.5 py-1 ${
                metric === "actions" ? "bg-gold text-background" : "text-muted hover:text-foreground"
              }`}
            >
              Actions
            </button>
            <button
              onClick={() => setMetric("tokens")}
              className={`px-2.5 py-1 ${
                metric === "tokens" ? "bg-gold text-background" : "text-muted hover:text-foreground"
              }`}
            >
              Tokens
            </button>
          </div>
        </div>

        {metric === "actions" ? (
          <>
            <div className="text-sm text-muted">
              {summary.actionsUsed} / {summary.monthlyActions} AI actions used
            </div>
            <div className="h-2 rounded-full bg-black/20 overflow-hidden">
              <div
                className={`h-full ${pct >= 100 ? "bg-red-400" : "bg-gold"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">
            {totalTokens.toLocaleString()} tokens used this month ({summary.inputTokensUsed.toLocaleString()} in
            / {summary.outputTokensUsed.toLocaleString()} out) — your plan&apos;s limit is measured in AI actions,
            not tokens.
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((planId) => {
          const plan = PLAN_LIMITS[planId];
          const isCurrent = summary.plan === planId;
          return (
            <div
              key={planId}
              className={`rounded-lg border p-4 flex flex-col gap-3 ${
                isCurrent ? "border-gold bg-surface" : "border-border bg-surface"
              }`}
            >
              <div>
                <div className="font-semibold">{plan.label}</div>
                <div className="text-xs text-muted mt-1">
                  {plan.maxChildren === null
                    ? "Unlimited children"
                    : `${plan.maxChildren} child${plan.maxChildren === 1 ? "" : "ren"}`}
                </div>
                <div className="text-xs text-muted">{plan.monthlyActions} AI actions / month</div>
              </div>
              {isCurrent ? (
                <span className="text-xs text-gold">Current plan</span>
              ) : (
                <button
                  onClick={() => handleSwitch(planId)}
                  disabled={switching === planId}
                  className="btn-secondary text-xs"
                >
                  {switching === planId ? "Switching…" : `Switch to ${plan.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
