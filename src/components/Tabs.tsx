"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type Tab = {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
};

/** A fully-controlled, content-embedding tab bar -- not admin-specific
 * despite its original home, so it's shared between /admin and the
 * redesigned /settings page. */
export default function Tabs({ tabs }: { tabs: Tab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Standard tabs roving-tabindex pattern (WAI-ARIA APG): arrow keys move
  // both focus and selection between tabs, Home/End jump to the ends --
  // without this, a keyboard user tabbing into the bar can only ever reach
  // whichever tab happens to already be active.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const next = tabs[nextIndex];
    setActiveId(next.id);
    buttonRefs.current[next.id]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        className="flex gap-1 border-b border-navy-line overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >

        {tabs.map((tab, index) => {
          const isActive = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttonRefs.current[tab.id] = el;
              }}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`shrink-0 flex items-center gap-2 border-b-2 -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "border-gold text-gold" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-xs ${
                    isActive ? "bg-gold/15 text-gold" : "bg-navy-soft text-muted"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div id={`tabpanel-${active.id}`} role="tabpanel" aria-labelledby={`tab-${active.id}`}>
          {active.content}
        </div>
      )}
    </div>
  );
}
