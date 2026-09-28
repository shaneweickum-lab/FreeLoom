"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** FreeLoom itself only ever sets one cookie today (Supabase's auth/session
 * cookie) plus one localStorage key (the active-student selector) -- both
 * strictly necessary, never gated behind consent, and always on. Analytics
 * and marketing are provisioned here for if/when a real tool is ever wired
 * in, not because one exists yet -- see docs/privacy note in
 * src/app/privacy/page.tsx. Nothing in this file loads a script itself;
 * a future analytics integration should check hasStoredConsent("analytics")
 * (the plain, non-React helper below) before loading anything. */
export type ConsentCategory = "analytics" | "marketing";

export type ConsentRecord = {
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
};

const STORAGE_KEY = "freeloom-cookie-consent";

function readStoredConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.analytics === "boolean" && typeof parsed?.marketing === "boolean") {
      return parsed as ConsentRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** For non-React code (e.g. a future analytics loader) that needs a plain
 * synchronous check rather than the hook below -- reads the same storage,
 * defaults closed (false) for anything not yet decided or not accepted. */
export function hasStoredConsent(category: ConsentCategory): boolean {
  return readStoredConsent()?.[category] === true;
}

type CookieConsentContextValue = {
  /** null until the visitor has made a choice at least once. */
  consent: ConsentRecord | null;
  /** True while the banner/preferences panel should render -- either no
   * decision has been made yet, or the visitor reopened it manually. */
  panelOpen: boolean;
  acceptAll: () => void;
  rejectNonEssential: () => void;
  savePreferences: (categories: { analytics: boolean; marketing: boolean }) => void;
  openPreferences: () => void;
  closePreferences: () => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [manuallyOpened, setManuallyOpened] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(readStoredConsent());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: ConsentRecord) => {
    setConsent(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setManuallyOpened(false);
  }, []);

  const acceptAll = useCallback(() => {
    persist({ analytics: true, marketing: true, decidedAt: new Date().toISOString() });
  }, [persist]);

  const rejectNonEssential = useCallback(() => {
    persist({ analytics: false, marketing: false, decidedAt: new Date().toISOString() });
  }, [persist]);

  const savePreferences = useCallback(
    (categories: { analytics: boolean; marketing: boolean }) => {
      persist({ ...categories, decidedAt: new Date().toISOString() });
    },
    [persist]
  );

  const openPreferences = useCallback(() => setManuallyOpened(true), []);
  const closePreferences = useCallback(() => setManuallyOpened(false), []);

  // Not hydrated yet (first client render) -> stay closed rather than
  // flashing the banner then immediately hiding it once localStorage loads.
  const panelOpen = hydrated && (consent === null || manuallyOpened);

  return (
    <CookieConsentContext.Provider
      value={{ consent, panelOpen, acceptAll, rejectNonEssential, savePreferences, openPreferences, closePreferences }}
    >
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent() {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) throw new Error("useCookieConsent must be used within a CookieConsentProvider");
  return ctx;
}
