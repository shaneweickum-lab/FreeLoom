import type { PlanId } from "@/lib/types";

export type PlanLimit = {
  plan: PlanId;
  label: string;
  maxChildren: number | null;
  monthlyActions: number;
};

export const PLAN_LIMITS: Record<PlanId, PlanLimit> = {
  free: { plan: "free", label: "Free", maxChildren: 1, monthlyActions: 30 },
  plus: { plan: "plus", label: "Plus", maxChildren: 3, monthlyActions: 300 },
  pro: { plan: "pro", label: "Pro", maxChildren: null, monthlyActions: 1500 },
};

export const PLAN_ORDER: PlanId[] = ["free", "plus", "pro"];
