"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import AssistantChat from "@/components/AssistantChat";

export default function AssistantDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The dedicated /assistant page already renders the full chat — avoid a redundant floating copy there.
  if (pathname === "/assistant") return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="hidden md:flex fixed bottom-6 right-6 z-40 h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-background shadow-lg hover:scale-105 transition-transform"
        >
          <span className="text-xl font-bold">F</span>
        </button>
      )}

      <div
        className={`hidden md:flex fixed top-0 right-0 z-50 h-full w-[400px] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <span className="font-semibold">Assistant</span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="text-muted hover:text-foreground text-sm"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 p-3">
          <AssistantChat compact />
        </div>
      </div>
    </>
  );
}
