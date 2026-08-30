"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** FreeLoom itself only ever sets one cookie today (Supabase's auth/session
 * cookie) plus one localStorage key (the active-student selector) -- both
 * strictly necessary, never gated behind consent, and always on. Analytics
 * and marketing are provisioned here for if/when a real tool is ever wired
 * in, not because one exists yet -- see docs/privacy note in
 * src/app/privacy/page.tsx. Nothing in this file loads a script itself;
 * a future analytics integration should check hasStoredConsent("analytics")
 * (the plain, non-React helper below) before loading anything.
 *
 * "aiModel" is different from the other two: it's real and load-bearing
 * today, not reserved for later. Benny's assistant-mode chat and the
 * classify pipeline's Stage 4 drafting run a real AI model (Llama 3.2 1B,
 * or Qwen2.5 0.5B on mobile) downloaded straight into the browser via
 * WebGPU/WebLLM and cached in IndexedDB -- a genuinely large,
 * bandwidth/storage-using download, not a cookie in the traditional
 * sense, which is exactly why it needs its own explicit disclosure rather
 * than being folded into "necessary." See src/lib/benny/webllm/ for what
 * actually gets downloaded, and hasStoredConsent("aiModel") is the one
 * gate every call site there must check before ever starting a download. */
export type ConsentCategory = "analytics" | "marketing" | "aiModel";

export type ConsentRecord = {
  analytics: boolean;
  marketing: boolean;
  aiModel: boolean;
  decidedAt: string;
};

const STORAGE_KEY = "freeloom-cookie-consent";

/** Pure validation/backfill of whatever JSON.parse produced from storage
 * -- kept separate from the actual localStorage/window access below so
 * it's unit-testable without a DOM environment (this project's test
 * suite runs in plain Node, no jsdom). */
export function normalizeStoredConsent(parsed: unknown): ConsentRecord | null {
  const record = parsed as Record<string, unknown> | null | undefined;
  if (typeof record?.analytics !== "boolean" || typeof record?.marketing !== "boolean") return null;

  // A record saved before the aiModel category existed has no opinion on
  // it yet -- default closed (false), the same "not decided yet" behavior
  // as if the whole record were missing, rather than treating an old
  // decision as an implicit yes to something that didn't exist when that
  // decision was made.
  const aiModel = typeof record.aiModel === "boolean" ? record.aiModel : false;
  return { analytics: record.analytics, marketing: record.marketing, aiModel, decidedAt: String(record.decidedAt ?? "") };
}

function readStoredConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredConsent(JSON.parse(raw));
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
  savePreferences: (categories: { analytics: boolean; marketing: boolean; aiModel: boolean }) => void;
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
    persist({ analytics: true, marketing: true, aiModel: true, decidedAt: new Date().toISOString() });
  }, [persist]);

  const rejectNonEssential = useCallback(() => {
    persist({ analytics: false, marketing: false, aiModel: false, decidedAt: new Date().toISOString() });
  }, [persist]);

  const savePreferences = useCallback(
    (categories: { analytics: boolean; marketing: boolean; aiModel: boolean }) => {
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
