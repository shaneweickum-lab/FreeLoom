"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";

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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleToggle() {
    const opening = !open;
    setOpen(opening);
    if (!opening) return;

    // Opening the dropdown marks message/announcement notifications read.
    // access_request notifications stay actionable until actually
    // responded to -- that happens via respond() below, not just by looking.
    const supabase = createClient();
    const idsToMark = notifications.filter((n) => n.type !== "access_request" && !n.read_at).map((n) => n.id);
    if (idsToMark.length > 0) {
      const readAt = new Date().toISOString();
      await supabase.from("notifications").update({ read_at: readAt }).in("id", idsToMark);
      setNotifications((prev) => prev.map((n) => (idsToMark.includes(n.id) ? { ...n, read_at: readAt } : n)));
    }
  }

  async function respond(notification: AppNotification, action: "approve" | "deny") {
    if (!notification.related_id) return;
    setBusyId(notification.id);
    const res = await fetch(`/api/access-requests/${notification.related_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (res.ok) load();
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
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-navy-line bg-navy-soft shadow-lg z-40 p-2 flex flex-col gap-1">
          {loading && <p className="text-xs text-muted p-2">Loading…</p>}
          {!loading && notifications.length === 0 && <p className="text-xs text-muted p-2">Nothing yet.</p>}
          {notifications.map((n) => (
            <div key={n.id} className={`rounded-md p-2 text-sm ${!n.read_at ? "bg-surface-hover" : ""}`}>
              <p className="font-medium text-foreground">{n.title}</p>
              {n.body && <p className="text-xs text-muted mt-0.5">{n.body}</p>}
              <p className="text-[10px] text-muted/70 mt-1">{new Date(n.created_at).toLocaleString()}</p>
              {n.type === "access_request" && !n.read_at && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => respond(n, "approve")}
                    disabled={busyId === n.id}
                    className="btn-primary text-xs px-2 py-1"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => respond(n, "deny")}
                    disabled={busyId === n.id}
                    className="btn-secondary text-xs px-2 py-1"
                  >
                    Deny
                  </button>
                </div>
              )}
              {n.type === "access_request" && n.read_at && <p className="text-xs text-muted mt-1 italic">Responded</p>}
              {n.type !== "access_request" && n.link_path && (
                <Link
                  href={n.link_path}
                  onClick={() => setOpen(false)}
                  className="text-xs text-gold hover:underline mt-1 inline-block"
                >
                  View
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
