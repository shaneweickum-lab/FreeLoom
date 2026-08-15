import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPriceTable } from "@/lib/billing/prices";
import { resolveHouseholdOwnerId } from "@/lib/household";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import AcceptHouseholdInvite from "@/components/onboarding/AcceptHouseholdInvite";

/** Standalone route (like /login), deliberately outside the (app) route
 * group -- the full nav rail/StudentSwitcher/Benny trigger would be noise
 * (and actively confusing: StudentSwitcher would show "no students yet")
 * during a first-run "set up your profile, then pick a plan" walkthrough.
 * This is also the first page in the app that hard-redirects a signed-out
 * visitor rather than rendering a "Not signed in" fallback in place --
 * onboarding genuinely shouldn't be reachable without a session. */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  // An accepted household member already belongs to an existing household
  // -- nothing to onboard, there's no school for them to set up from
  // scratch. Sent straight into the app instead of this wizard.
  const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
  if (ownerId && ownerId !== user.id) redirect("/dashboard");

  // No school_profiles row of their own and no accepted membership yet --
  // but if there's a *pending* invite matching their email, they signed up
  // specifically to join someone else's household, not to start a new one.
  if (!ownerId && user.email) {
    const { data: pendingInvite } = await supabase
      .from("household_members")
      .select("id")
      .eq("invited_email", user.email)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingInvite) {
      return (
        <div className="mx-auto max-w-2xl w-full flex flex-col gap-8 py-16 px-4 sm:px-6">
          <AcceptHouseholdInvite ownerName={null} />
        </div>
      );
    }
  }

  const [{ data: profile }, prices] = await Promise.all([
    supabase.from("school_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    fetchPriceTable(),
  ]);

  return (
    <div className="mx-auto max-w-2xl w-full flex flex-col gap-8 py-16 px-4 sm:px-6">
      <OnboardingWizard userId={user.id} initialProfile={profile ?? null} prices={prices} />
    </div>
  );
}
