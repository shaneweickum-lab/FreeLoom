import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPriceTable } from "@/lib/billing/prices";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

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
