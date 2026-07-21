"use client";

import { useEffect } from "react";
import { useBennyPanel } from "@/lib/bennyPanelContext";
import BennyConversations from "@/components/BennyConversations";

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** The Benny chat drawer. Mounted at the AppShell/ThemedShell level (a
 * sibling of AppRail and <main>), NOT nested inside AppRail's own <aside> --
 * AppRail applies a Tailwind `transform` for its mobile off-canvas effect
 * (translate-x-*), and any CSS transform on an ancestor establishes a new
 * containing block for position:fixed descendants. A fixed-position drawer
 * nested inside that aside would position relative to the aside instead of
 * the viewport, breaking the overlay. Structure otherwise mirrors AppRail's
 * own mobile backdrop convention. */
export default function BennyPanel() {
  const { open, close } = useBennyPanel();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden onClick={close} className="fixed inset-0 z-40 bg-navy-deep/70" />
      <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-[36rem] max-w-full border-l border-border bg-surface flex flex-col p-4 gap-3 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <h2 className="font-serif text-lg">Benny</h2>
          <button
            onClick={close}
            aria-label="Close Benny"
            className="h-8 w-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <BennyConversations />
        </div>
      </aside>
    </>
  );
}
