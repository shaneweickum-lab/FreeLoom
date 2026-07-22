"use client";

import { useCookieConsent } from "@/lib/cookieConsent";

/** Reopens the cookie consent panel (see CookieConsentBanner.tsx, mounted
 * once at the root layout) -- the one place a visitor can change their
 * choice after the first visit, since the banner itself only shows
 * automatically before a decision has been made. */
export default function CookiePreferencesButton({ className }: { className?: string }) {
  const { openPreferences } = useCookieConsent();
  return (
    <button onClick={openPreferences} className={className}>
      Cookie preferences
    </button>
  );
}
