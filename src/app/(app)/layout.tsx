import { createClient } from "@/lib/supabase/server";
import { resolveHouseholdOwnerId } from "@/lib/household";
import AppShell from "@/components/AppShell";
import type { Theme } from "@/lib/themeContext";

// Reads the saved theme preference server-side so there's no flash of the
// wrong theme on load -- defaults to "dark" (today's only theme) when
// logged out or before a preference has ever been saved, matching
// theme_preference's own DB default.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialTheme: Theme = "dark";
  if (user) {
    const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
    if (ownerId) {
      const { data: profile } = await supabase
        .from("school_profiles")
        .select("theme_preference")
        .eq("user_id", ownerId)
        .maybeSingle();
      if (profile?.theme_preference === "light") initialTheme = "light";
    }
  }

  return <AppShell initialTheme={initialTheme}>{children}</AppShell>;
}
