"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNotifications } from "@/lib/useNotifications";
import NotificationItem from "@/components/NotificationItem";

function BellIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { notifications, loading, markAllRead, reload } = useNotifications(20);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  function handleToggle() {
    const opening = !open;
    setOpen(opening);
    // Opening the dropdown marks message/announcement notifications read.
    // access_request notifications stay actionable until actually
    // responded to -- markAllRead already excludes those.
    if (opening) markAllRead();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={handleToggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative h-9 w-9 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-gold" />}
      </button>

      {open && (
        // The rail is only ~288px wide (w-72), so a 320px dropdown anchored
        // right-0 would overhang the rail's own left edge and run off the
        // browser window entirely. Below md (the mobile top bar, where the
        // bell sits near the *right* edge of a full-width screen) right-0
        // is correct; at md+ (the desktop rail, where the bell sits near
        // the right edge of a *narrow* sidebar) it needs to open from the
        // left instead, extending rightward over the main content.
        <div className="absolute right-0 md:left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto rounded-lg border border-navy-line bg-navy-soft shadow-lg z-40 p-2 flex flex-col gap-1">
          {loading && <p className="text-xs text-muted p-2">Loading…</p>}
          {!loading && notifications.length === 0 && <p className="text-xs text-muted p-2">Nothing yet.</p>}
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} onResponded={reload} onOpenLink={() => setOpen(false)} />
          ))}
          {notifications.length > 0 && (
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-center text-xs text-gold hover:underline pt-1 mt-1 border-t border-navy-line"
            >
              See all notifications
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
