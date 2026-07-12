"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { getUsageSummary, type UsageSummary } from "@/lib/usage";
import { ACTION_PACKS } from "@/lib/plans";
import type { PlanId } from "@/lib/types";

export type UsageMetric = "actions" | "tokens";

const METRIC_KEY = "freeloom-usage-metric";

type PlanContextValue = {
  loading: boolean;
  summary: UsageSummary | null;
  metric: UsageMetric;
  setMetric: (m: UsageMetric) => void;
  refresh: () => Promise<void>;
  switchPlan: (plan: PlanId) => Promise<boolean>;
  purchaseActionPack: (packId: string) => Promise<boolean>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetricState] = useState<UsageMetric>(() => {
    if (typeof window === "undefined") return "actions";
    const stored = window.localStorage.getItem(METRIC_KEY);
    return stored === "actions" || stored === "tokens" ? stored : "actions";
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSummary(null);
      setLoading(false);
      return;
    }
    const next = await getUsageSummary(supabase, user.id);
    setSummary(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const setMetric = useCallback((m: UsageMetric) => {
    setMetricState(m);
    window.localStorage.setItem(METRIC_KEY, m);
  }, []);

  const switchPlan = useCallback(
    async (plan: PlanId) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;
      const { error } = await supabase
        .from("account_plans")
        .upsert({ user_id: user.id, plan, updated_at: new Date().toISOString() });
      if (error) return false;
      await refresh();
      return true;
    },
    [refresh]
  );

  const purchaseActionPack = useCallback(
    async (packId: string) => {
      if (!summary || summary.plan !== "plus") return false;
      const pack = ACTION_PACKS.find((p) => p.id === packId);
      if (!pack) return false;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;
      const { error } = await supabase
        .from("usage_topups")
        .insert({ user_id: user.id, actions_granted: pack.actions, price_paid: pack.price });
      if (error) return false;
      await refresh();
      return true;
    },
    [summary, refresh]
  );

  return (
    <PlanContext.Provider value={{ loading, summary, metric, setMetric, refresh, switchPlan, purchaseActionPack }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within a PlanProvider");
  return ctx;
}
