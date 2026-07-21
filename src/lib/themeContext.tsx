"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

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
      await supabase.from("school_profiles").upsert({
        user_id: user.id,
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
