"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCookieConsent } from "@/lib/cookieConsent";

/** Mounted once at the root layout, so it's present on every route
 * (marketing landing page and the authenticated app alike) -- the only
 * cookie it's actually gating today is hypothetical (see cookieConsent.tsx:
 * no analytics/marketing tool is wired in yet), but the choice, once made,
 * is honored the moment one is. */
export default function CookieConsentBanner() {
  const { panelOpen, consent, acceptAll, rejectNonEssential, savePreferences, closePreferences } = useCookieConsent();
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);

  const hasExistingDecision = consent !== null;

  // Escape only closes when there's already a saved decision to fall back
  // on (same condition the visible Close button below already uses) -- a
  // first-time visitor with no decision yet shouldn't be able to dismiss
  // this without an explicit choice.
  useEffect(() => {
    if (!panelOpen || !hasExistingDecision) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closePreferences();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, hasExistingDecision, closePreferences]);

  if (!panelOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy-line bg-navy-soft shadow-2xl"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 flex flex-col gap-3">
        {!customizing ? (
          <>
            <p className="text-sm text-foreground">
              FreeLoom uses one essential cookie to keep you signed in -- nothing else, no analytics or advertising
              cookies today. See our{" "}
              <Link href="/privacy" className="text-gold hover:underline">
                Privacy &amp; Cookie Policy
              </Link>{" "}
              for the full list and what it would mean if that ever changes.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={acceptAll} className="btn-primary text-sm">
                Accept all
              </button>
              <button onClick={rejectNonEssential} className="btn-secondary text-sm">
                Reject non-essential
              </button>
              <button
                onClick={() => setCustomizing(true)}
                className="text-sm text-muted hover:text-foreground underline underline-offset-2"
              >
                Customize
              </button>
              {hasExistingDecision && (
                <button
                  onClick={closePreferences}
                  className="ml-auto text-sm text-muted hover:text-foreground"
                  aria-label="Close"
                >
                  Close
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground">Choose which optional categories you&apos;re okay with.</p>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center justify-between gap-2 rounded-md border border-navy-line px-3 py-2">
                <span>
                  <span className="font-medium">Necessary</span>
                  <span className="block text-xs text-muted">Keeps you signed in. Always on -- the site can&apos;t work without it.</span>
                </span>
                <input type="checkbox" checked disabled className="shrink-0" />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md border border-navy-line px-3 py-2">
                <span>
                  <span className="font-medium">Analytics</span>
                  <span className="block text-xs text-muted">Not currently used -- reserved in case that changes.</span>
                </span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="shrink-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md border border-navy-line px-3 py-2">
                <span>
                  <span className="font-medium">Marketing</span>
                  <span className="block text-xs text-muted">Not currently used -- reserved in case that changes.</span>
                </span>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="shrink-0"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => savePreferences({ analytics, marketing })} className="btn-primary text-sm">
                Save preferences
              </button>
              <button
                onClick={() => setCustomizing(false)}
                className="text-sm text-muted hover:text-foreground underline underline-offset-2"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
