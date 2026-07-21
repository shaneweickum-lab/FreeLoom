"use client";

import { useState, type ReactNode } from "react";

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

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        className="flex gap-1 border-b border-navy-line overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >

        {tabs.map((tab) => {
          const isActive = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(tab.id)}
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
      {active?.content}
    </div>
  );
}
