import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS } from "@/lib/plans";
import type { PlanId } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;

export type ActionType = "translate_log" | "suggest_tracks" | "assistant_chat";

export type UsageContext = { supabase: Supa; userId: string };

export type UsageSummary = {
  plan: PlanId;
  maxChildren: number | null;
  /** Effective action cap for the current calendar month: plan base + any purchased top-ups. */
  monthlyActions: number;
  baseMonthlyActions: number;
  topupActions: number;
  actionsUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
};

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
}

export async function getUserPlan(supabase: Supa, userId: string): Promise<PlanId> {
  const { data } = await supabase.from("account_plans").select("plan").eq("user_id", userId).maybeSingle();
  return (data?.plan as PlanId | undefined) ?? "free";
}

export async function getMonthlyUsage(
  supabase: Supa,
  userId: string
): Promise<{ actions: number; inputTokens: number; outputTokens: number }> {
  const { data } = await supabase
    .from("usage_events")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", monthStartIso());
  const rows = data ?? [];
  return {
    actions: rows.length,
    inputTokens: rows.reduce((sum: number, r: { input_tokens: number }) => sum + r.input_tokens, 0),
    outputTokens: rows.reduce((sum: number, r: { output_tokens: number }) => sum + r.output_tokens, 0),
  };
}

export async function getMonthlyTopupActions(supabase: Supa, userId: string): Promise<number> {
  const { data } = await supabase
    .from("usage_topups")
    .select("actions_granted")
    .eq("user_id", userId)
    .gte("created_at", monthStartIso());
  return (data ?? []).reduce((sum: number, r: { actions_granted: number }) => sum + r.actions_granted, 0);
}

export async function getUsageSummary(supabase: Supa, userId: string): Promise<UsageSummary> {
  const [plan, usage, topupActions] = await Promise.all([
    getUserPlan(supabase, userId),
    getMonthlyUsage(supabase, userId),
    getMonthlyTopupActions(supabase, userId),
  ]);
  const limits = PLAN_LIMITS[plan];
  return {
    plan,
    maxChildren: limits.maxChildren,
    baseMonthlyActions: limits.monthlyActions,
    topupActions,
    monthlyActions: limits.monthlyActions + topupActions,
    actionsUsed: usage.actions,
    inputTokensUsed: usage.inputTokens,
    outputTokensUsed: usage.outputTokens,
  };
}

export async function hasQuotaRemaining(supabase: Supa, userId: string): Promise<boolean> {
  const summary = await getUsageSummary(supabase, userId);
  return summary.actionsUsed < summary.monthlyActions;
}

export async function recordUsage(
  supabase: Supa,
  userId: string,
  actionType: ActionType,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  await supabase
    .from("usage_events")
    .insert({ user_id: userId, action_type: actionType, input_tokens: inputTokens, output_tokens: outputTokens });
}
