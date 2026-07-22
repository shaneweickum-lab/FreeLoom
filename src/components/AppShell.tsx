"use client";

import { useEffect } from "react";
import { StudentProvider } from "@/lib/studentContext";
import { ThemeProvider, useTheme, type Theme } from "@/lib/themeContext";
import { BennyPanelProvider } from "@/lib/bennyPanelContext";
import { clearRememberMeMarkers, shouldForceSignOutForRememberMe } from "@/lib/authSession";
import { createClient } from "@/lib/supabase/client";
import AppRail from "@/components/AppRail";
import BennyPanel from "@/components/BennyPanel";

// data-theme has to come from useTheme() (live state), not the initialTheme
// prop directly -- otherwise toggling Appearance in Settings would update
// the saved preference but never actually repaint anything, since the div
// carrying the attribute would still hold whatever value it rendered with
// on first load.
function ThemedShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <div data-theme={theme} className="flex flex-col md:flex-row min-h-screen">
      <AppRail />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-8 sm:py-10">
        {/* Every page here was built assuming the old root layout's
            max-w-5xl wrapper; without a cap here they'd stretch
            edge-to-edge next to the rail on a wide screen. */}
        <div className="max-w-4xl">{children}</div>
      </main>
      {/* Sibling of AppRail, not nested inside it -- see BennyPanel.tsx's
          header comment for why (AppRail's own transform breaks fixed-
          position descendants). */}
      <BennyPanel />
    </div>
  );
}

// The persistent left rail from the app redesign brief: brand mark, the
// student switcher, nav links, and the per-subject credit ledger, all in
// one column that stays put while the main content area changes. Stacks
// above the content on mobile instead of a sidebar (AppRail renders its own
// compact top bar + off-canvas drawer below md).
//
// data-theme lives on this div (not the root layout's <html>) so a
// logged-in user's theme preference can never leak onto the public
// marketing pages, which don't render inside this component at all -- see
// the [data-theme="light"] block in globals.css.
export default function AppShell({ initialTheme, children }: { initialTheme: Theme; children: React.ReactNode }) {
  // Enforces the "Keep me signed in" choice from login -- see
  // src/lib/authSession.ts for why this can't be done via the Supabase
  // client's own cookie config. Runs once per fresh page load into the app;
  // the server-verified session cookie itself is still valid at this point
  // (proxy.ts already let the request through), this only catches the case
  // where the parent explicitly asked not to be remembered past closing
  // the browser.
  useEffect(() => {
    if (!shouldForceSignOutForRememberMe()) return;
    clearRememberMeMarkers();
    const supabase = createClient();
    supabase.auth.signOut().finally(() => {
      window.location.href = "/login";
    });
  }, []);

  return (
    <ThemeProvider initialTheme={initialTheme}>
      <StudentProvider>
        <BennyPanelProvider>
          <ThemedShell>{children}</ThemedShell>
        </BennyPanelProvider>
      </StudentProvider>
    </ThemeProvider>
  );
}
