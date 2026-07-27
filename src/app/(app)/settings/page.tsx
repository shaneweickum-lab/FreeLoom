import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchPriceTable } from "@/lib/billing/prices";
import SettingsTabs from "@/components/settings/SettingsTabs";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p className="text-sm text-muted">Not signed in.</p>;
  }

  const [{ data: profile }, { data: adminRow }, prices] = await Promise.all([
    supabase.from("school_profiles").select("*").eq("user_id", user.id).maybeSingle(),
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
        <SettingsTabs userId={user.id} initialProfile={profile ?? null} isAdmin={!!adminRow} prices={prices} />
      </Suspense>
    </div>
  );
}
