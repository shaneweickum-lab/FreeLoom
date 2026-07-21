"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type BennyPanelContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const BennyPanelContext = createContext<BennyPanelContextValue | null>(null);

/** Pure UI open/close state for the Benny chat panel -- no data fetching,
 * same createContext/useContext shape as studentContext.tsx/themeContext.tsx
 * (this repo's "one context per cross-cutting concern" convention). Needed
 * because the trigger button (in AppRail) and the panel itself (in
 * AppShell's ThemedShell, as a sibling of AppRail -- see BennyPanel.tsx for
 * why it can't nest inside AppRail's own <aside>) aren't parent/child. */
export function BennyPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return <BennyPanelContext.Provider value={{ open, toggle, close }}>{children}</BennyPanelContext.Provider>;
}

export function useBennyPanel() {
  const ctx = useContext(BennyPanelContext);
  if (!ctx) throw new Error("useBennyPanel must be used within a BennyPanelProvider");
  return ctx;
}
