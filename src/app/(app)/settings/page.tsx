import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchPriceTable } from "@/lib/billing/prices";
import { isHouseholdOwner, resolveHouseholdOwnerId } from "@/lib/household";
import SettingsTabs from "@/components/settings/SettingsTabs";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p className="text-sm text-muted">Not signed in.</p>;
  }

  // Resolved to the household's owner id, not necessarily user.id -- every
  // settings tab upserts school_profiles keyed to this value, so an
  // accepted guardian's saves land on the shared row instead of forking a
  // phantom one under their own id (see household.ts's own doc comment).
  const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
  const isOwner = isHouseholdOwner(user.id, ownerId);

  const [{ data: profile }, { data: adminRow }, prices] = await Promise.all([
    ownerId
      ? supabase.from("school_profiles").select("*").eq("user_id", ownerId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle(),
    fetchPriceTable(),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div>
        <h1 className="font-serif text-2xl font-bold">Settings</h1>
        <p className="text-muted text-sm mt-1">Your account, preferences, and how FreeLoom reaches you.</p>
      </div>
      <Suspense fallback={null}>
        <SettingsTabs
          userId={ownerId ?? user.id}
          isOwner={isOwner}
          initialProfile={profile ?? null}
          isAdmin={!!adminRow}
          prices={prices}
          authEmail={user.email ?? null}
        />
      </Suspense>
    </div>
  );
}
