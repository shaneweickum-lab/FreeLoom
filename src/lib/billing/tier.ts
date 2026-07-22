import type { SchoolProfile } from "@/lib/types";

export type SubscriptionTier = "free" | "pro" | "premium";

export const STUDENT_CAP: Record<SubscriptionTier, number> = { free: 1, pro: 3, premium: 12 };

/** null (in addition to these) is always allowed for premium (the "Never"
 * retention option) -- see getMaxRetentionDays / NotificationsTab.tsx. */
export const MAX_RETENTION_DAYS: Record<SubscriptionTier, number> = { free: 7, pro: 14, premium: 30 };

/** Stripe keeps retrying a failed renewal charge (Smart Retries) for days
 * after the billing cycle's end date -- cutting access the instant a
 * single attempt fails would punish a customer mid-retry for what's often
 * just a momentarily-declined card. This grace window covers exactly that
 * gap; mirrored in effective_tier()'s SQL. */
export const GRACE_PERIOD_DAYS = 5;
const GRACE_ELIGIBLE_STATUSES = new Set(["past_due", "unpaid"]);

type TierInputProfile = Pick<SchoolProfile, "subscription_tier" | "subscription_status" | "grandfathered_until"> & {
  /** Only needed for the past_due/unpaid grace window -- optional so every
   * existing caller that hasn't loaded this column still compiles. */
  current_period_end?: string | null;
  /** True when this account itself is a platform admin -- billing tiers
   * never apply to admins; the whole platform is at their disposal
   * regardless of subscription state. Mirrored in effective_tier() SQL via
   * an admin_users check. */
  isAdmin?: boolean;
};

/** The single source of truth for "what tier does this account actually
 * get, right now" -- mirrored exactly by the `effective_tier()` SQL
 * function (see the billing-tiers migration SQL); the two must stay in
 * sync if either changes. Precedence: an admin account always gets full
 * access; then a real active/trialing subscription; then a past_due/
 * unpaid subscription still within its grace window; then the grandfather
 * window as a fallback for accounts with no real subscription at all.
 * Every gate in the app should read tier through this function, never
 * re-derive it independently. */
export function getEffectiveTier(profile: TierInputProfile): SubscriptionTier {
  if (profile.isAdmin) return "premium";
  if (profile.subscription_status === "active" || profile.subscription_status === "trialing") {
    return profile.subscription_tier;
  }
  if (
    profile.subscription_status &&
    GRACE_ELIGIBLE_STATUSES.has(profile.subscription_status) &&
    profile.current_period_end
  ) {
    const graceEndsAt = new Date(profile.current_period_end).getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    if (graceEndsAt > Date.now()) return profile.subscription_tier;
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
