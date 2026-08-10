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
  /** Only needed by isBennyAvailable()/getBennyUsageWindow() below --
   * optional so every existing tier.ts caller that isn't Benny-related
   * still compiles unchanged. */
  benny_trial_ends_at?: string | null;
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

export const PLAN_NAMES: Record<SubscriptionTier, string> = { free: "Free", pro: "Pro", premium: "Premium" };

/** The one canonical list of what each tier includes -- shared by
 * BillingTab.tsx (Settings) and the landing page's pricing section, so
 * the two can never drift into describing different plans. */
export function featuresFor(tier: SubscriptionTier): string[] {
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

/** Every new account gets one 14-day Benny trial regardless of tier
 * (benny_trial_ends_at's column default at row-creation time) -- this is
 * a one-time grant, not a recurring window, and is completely separate
 * from a Stripe-managed subscription_status of "trialing" above, which
 * only ever applies to a real paid-plan trial. */
export const BENNY_TRIAL_DAYS = 14;
export const BENNY_TRIAL_TOKEN_CAP = 100_000;
/** Pro's monthly Benny token budget. Premium is deliberately absent here
 * (getBennyUsageWindow returns cap: null for it) -- not literally
 * unlimited forever by omission, a real product decision that Premium
 * has no cap at all. */
export const BENNY_MONTHLY_TOKEN_CAP: Partial<Record<SubscriptionTier, number>> = { pro: 200_000 };

/** Hard kill-switch for Benny assistant-mode chat, independent of tier/
 * trial/opt-in state entirely -- flip to true once the underlying model's
 * platform_help answers are actually reliable. Eval against the real
 * fine-tuned adapter (ml/eval/run_eval_platform_help.py) showed it
 * confidently answering real app questions (billing, dark mode, adding
 * students) with plausible-sounding but WRONG specifics -- worse than no
 * answer at all, since a parent has no way to tell it's wrong. Setting
 * this false hides the feature entirely (AccountTab.tsx's toggle row,
 * AppRail.tsx's chat trigger) rather than showing it locked/disabled,
 * since a locked/disabled state would (wrongly) read as a tier/billing
 * limit -- misleading in a completely different way. entry_drafting and
 * kb_authoring aren't gated by this; only the direct user-facing Q&A path.
 */
export const BENNY_ASSISTANT_MODE_LAUNCHED = false;

/** Whether this account's *plan* allows Benny assistant mode right now --
 * either a real paid tier, or still inside the one-time trial window every
 * new account gets. Independent of the per-account benny_assistant_enabled
 * opt-in toggle (AccountTab.tsx/AppRail.tsx check that separately) -- this
 * only answers "is the plan allowed to use it," not "has this parent
 * turned it on," and not "has this feature launched at all" (see
 * BENNY_ASSISTANT_MODE_LAUNCHED above, which callers check separately so
 * the not-launched-yet state can be hidden rather than shown locked). */
export function isBennyAvailable(profile: TierInputProfile): boolean {
  if (getEffectiveTier(profile) !== "free") return true;
  return !!profile.benny_trial_ends_at && new Date(profile.benny_trial_ends_at) > new Date();
}

export type BennyUsageWindow = {
  /** Total tokens allowed in this window, or null for no cap (Premium). */
  cap: number | null;
  /** Usage is summed from this point forward when enforcing the cap. */
  periodStart: Date;
  /** When the cap lifts/resets -- null only when there's no cap at all. */
  resetsAt: Date | null;
  source: "trial" | "monthly_pro" | "unlimited";
};

/** How much Benny usage this account gets and over what window, given it's
 * already passed isBennyAvailable(). Trial usage is measured across the
 * whole 14-day trial (a one-time budget, not a rolling window); Pro's cap
 * resets every calendar month (UTC) -- deliberately a fixed calendar
 * boundary rather than the exact Stripe billing-cycle date, which can
 * shift on upgrades/prorations and would make "resets on the 1st"-style
 * messaging inaccurate. */
export function getBennyUsageWindow(profile: TierInputProfile): BennyUsageWindow {
  const tier = getEffectiveTier(profile);
  if (tier === "premium") {
    return { cap: null, periodStart: new Date(0), resetsAt: null, source: "unlimited" };
  }
  if (tier === "pro") {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { cap: BENNY_MONTHLY_TOKEN_CAP.pro ?? null, periodStart, resetsAt, source: "monthly_pro" };
  }
  // Only reachable when isBennyAvailable() already confirmed this free-tier
  // account is inside its trial window -- benny_trial_ends_at is
  // guaranteed set and in the future.
  const trialEnd = new Date(profile.benny_trial_ends_at as string);
  const periodStart = new Date(trialEnd.getTime() - BENNY_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return { cap: BENNY_TRIAL_TOKEN_CAP, periodStart, resetsAt: trialEnd, source: "trial" };
}
