"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveHouseholdOwnerId } from "@/lib/household";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Wraps the authenticated app in a [data-theme] div (see globals.css) and
 * persists a change to school_profiles.theme_preference so it follows the
 * account across devices, not just this browser. `initialTheme` comes from
 * a server-side read in (app)/layout.tsx to avoid a flash of the wrong
 * theme on load. */
export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      // Resolved to the household's owner id -- an upsert keyed to the
      // caller's own id would otherwise silently create a second, phantom
      // school_profiles row for an accepted guardian instead of updating
      // the shared one everyone actually sees.
      const ownerId = await resolveHouseholdOwnerId(supabase, user.id);
      if (!ownerId) return;
      await supabase.from("school_profiles").upsert({
        user_id: ownerId,
        theme_preference: next,
        updated_at: new Date().toISOString(),
      });
    })();
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
