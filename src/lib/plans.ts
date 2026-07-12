import type { PlanId } from "@/lib/types";

export type PlanLimit = {
  plan: PlanId;
  label: string;
  maxChildren: number | null;
  monthlyActions: number;
  priceMonthly: number;
};

export const PLAN_LIMITS: Record<PlanId, PlanLimit> = {
  free: { plan: "free", label: "Free", maxChildren: 1, monthlyActions: 30, priceMonthly: 0 },
  plus: { plan: "plus", label: "Plus", maxChildren: 3, monthlyActions: 300, priceMonthly: 14.99 },
  pro: { plan: "pro", label: "Pro", maxChildren: null, monthlyActions: 1500, priceMonthly: 39.99 },
};

export const PLAN_ORDER: PlanId[] = ["free", "plus", "pro"];

export type ActionPack = { id: string; actions: number; price: number };

// Available only to Plus subscribers who need more than 300 actions in a given month.
export const ACTION_PACKS: ActionPack[] = [
  { id: "pack_200", actions: 200, price: 9.99 },
  { id: "pack_400", actions: 400, price: 14.99 },
];
