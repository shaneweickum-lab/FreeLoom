/**
 * Second-guardian access: a household stays owned by whichever account has
 * the school_profiles row (Stripe customer, billing, account deletion all
 * stay keyed to that literal user_id -- see the API routes that read
 * `user.id` straight from the session rather than any resolved id), but an
 * invited guardian gets full read/write on the day-to-day data (students,
 * entries, transcripts, messages) once accepted.
 *
 * Nearly every place in this app that scopes a query to "the current
 * user's own household" does it by filtering on the literal signed-in
 * user's id (`.eq("user_id", user.id)`) -- correct when every account was
 * its own household, but wrong the moment a second person can belong to
 * someone else's: an accepted guardian's own auth id was never the
 * household's `school_profiles.user_id`, so that filter would just return
 * nothing for them. resolveHouseholdOwnerId() is the one place that
 * distinction gets resolved -- every one of those call sites now resolves
 * "my household's owner id" through this function instead of assuming it's
 * always their own id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseholdMemberStatus = "pending" | "accepted" | "revoked";

export type HouseholdMember = {
  id: string;
  owner_user_id: string;
  member_user_id: string | null;
  invited_email: string;
  status: HouseholdMemberStatus;
  invited_at: string;
  accepted_at: string | null;
  created_at: string;
};

/**
 * Resolves which user_id's household the signed-in `userId` should see:
 * their own, if they own a school_profiles row, or the inviting owner's,
 * if they're an accepted household member. Null means "no household at
 * all yet" -- a brand-new, pre-onboarding account, same as every caller's
 * behavior before this feature existed.
 *
 * Checks ownership first (a single row lookup) rather than assuming "no
 * membership row means I must be the owner" -- an account can genuinely
 * be neither yet (freshly signed up, no school_profiles row, never
 * invited anywhere).
 */
export async function resolveHouseholdOwnerId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data: ownProfile } = await supabase.from("school_profiles").select("user_id").eq("user_id", userId).maybeSingle();
  if (ownProfile) return userId;

  const { data: membership } = await supabase
    .from("household_members")
    .select("owner_user_id")
    .eq("member_user_id", userId)
    .eq("status", "accepted")
    .maybeSingle();
  return membership?.owner_user_id ?? null;
}

/** Whether `userId` is the literal owner of the household rooted at
 * `ownerUserId` -- distinct from just being a household member at all,
 * used to gate owner-only actions (inviting/removing guardians, billing,
 * account deletion) that stay exclusive even to an otherwise full-access
 * accepted guardian. */
export function isHouseholdOwner(userId: string, ownerUserId: string | null): boolean {
  return ownerUserId !== null && userId === ownerUserId;
}
