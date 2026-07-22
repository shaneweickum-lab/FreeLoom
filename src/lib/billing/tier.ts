import type { SchoolProfile } from "@/lib/types";

export type SubscriptionTier = "free" | "pro" | "premium";

export const STUDENT_CAP: Record<SubscriptionTier, number> = { free: 1, pro: 3, premium: 12 };

/** null (in addition to these) is always allowed for premium (the "Never"
 * retention option) -- see getMaxRetentionDays / NotificationsTab.tsx. */
export const MAX_RETENTION_DAYS: Record<SubscriptionTier, number> = { free: 7, pro: 14, premium: 30 };

type TierInputProfile = Pick<SchoolProfile, "subscription_tier" | "subscription_status" | "grandfathered_until">;

/** The single source of truth for "what tier does this account actually
 * get, right now" -- mirrored exactly by the `effective_tier()` SQL
 * function (see the billing-tiers migration SQL); the two must stay in
 * sync if either changes. A real active/trialing subscription always
 * wins; the grandfather window is only a fallback for accounts with no
 * real subscription. Every gate in the app should read tier through this
 * function, never re-derive it independently. */
export function getEffectiveTier(profile: TierInputProfile): SubscriptionTier {
  if (profile.subscription_status === "active" || profile.subscription_status === "trialing") {
    return profile.subscription_tier;
  }
  if (profile.grandfathered_until && new Date(profile.grandfathered_until) > new Date()) return "premium";
  return "free";
}

export function getStudentCap(profile: TierInputProfile): number {
  return STUDENT_CAP[getEffectiveTier(profile)];
}

/** Null means "Never" (no auto-delete) -- only ever allowed for premium. */
export function isRetentionDaysAllowed(profile: TierInputProfile, days: number | null): boolean {
  const tier = getEffectiveTier(profile);
  if (days === null) return tier === "premium";
  return days >= 7 && days <= MAX_RETENTION_DAYS[tier];
}
