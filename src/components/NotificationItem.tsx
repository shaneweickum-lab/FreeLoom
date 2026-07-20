"use client";

import Link from "next/link";
import { useState } from "react";
import type { AppNotification } from "@/lib/types";

const TYPE_LABEL: Record<AppNotification["type"], string> = {
  message: "Message",
  announcement: "Announcement",
  access_request: "Access request",
};

/** One notification, shared between the bell dropdown and the full
 * /notifications inbox -- only the surrounding chrome differs between the
 * two (the inbox additionally offers delete; the dropdown doesn't). */
export default function NotificationItem({
  notification,
  onResponded,
  onOpenLink,
  onDelete,
}: {
  notification: AppNotification;
  onResponded?: () => void;
  onOpenLink?: () => void;
  onDelete?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function respond(action: "approve" | "deny") {
    if (!notification.related_id) return;
    setBusy(true);
    const res = await fetch(`/api/access-requests/${notification.related_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (res.ok) onResponded?.();
  }

  return (
    <div className={`rounded-md p-2 text-sm ${!notification.read_at ? "bg-surface-hover" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted">{TYPE_LABEL[notification.type]}</span>
          <p className="font-medium text-foreground">{notification.title}</p>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(notification.id)}
            aria-label="Delete notification"
            className="shrink-0 text-muted hover:text-red-400 transition-colors text-xs"
          >
            ✕
          </button>
        )}
      </div>
      {notification.body && <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{notification.body}</p>}
      <p className="text-[10px] text-muted/70 mt-1">{new Date(notification.created_at).toLocaleString()}</p>

      {notification.type === "access_request" && !notification.read_at && (
        <div className="flex gap-2 mt-2">
          <button onClick={() => respond("approve")} disabled={busy} className="btn-primary text-xs px-2 py-1">
            Approve
          </button>
          <button onClick={() => respond("deny")} disabled={busy} className="btn-secondary text-xs px-2 py-1">
            Deny
          </button>
        </div>
      )}
      {notification.type === "access_request" && notification.read_at && (
        <p className="text-xs text-muted mt-1 italic">Responded</p>
      )}
      {notification.type !== "access_request" && notification.link_path && (
        <Link
          href={notification.link_path}
          onClick={onOpenLink}
          className="text-xs text-gold hover:underline mt-1 inline-block"
        >
          View
        </Link>
      )}
    </div>
  );
}
