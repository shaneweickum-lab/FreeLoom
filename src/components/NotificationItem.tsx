"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";
import AnnouncementModal from "@/components/AnnouncementModal";
import type { AppNotification } from "@/lib/types";

const TYPE_LABEL: Record<AppNotification["type"], string> = {
  message: "Message",
  announcement: "Announcement",
  access_request: "Access request",
};

type LiveRequest = { status: string; expires_at: string | null } | null;

/** The live status of one account_access_requests row -- pending
 * (Approve/Deny), approved (a countdown identical in spirit to the admin's
 * own AccessRequestPanel), or a terminal state. Kept live via Realtime so
 * an admin's "Close access now" or an auto-expiry shows up here without a
 * refresh, same as the admin side sees the parent's approval instantly. */
function AccessRequestStatus({ requestId, onResponded }: { requestId: string; onResponded?: () => void }) {
  const [request, setRequest] = useState<LiveRequest>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const instanceId = useId();
  const countdown = useCountdown(request?.status === "approved" ? request.expires_at : null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("account_access_requests")
      .select("status, expires_at")
      .eq("id", requestId)
      .maybeSingle()
      .then(({ data }) => {
        setRequest(data);
        setLoading(false);
      });
  }, [requestId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`account_access_requests:${requestId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "account_access_requests", filter: `id=eq.${requestId}` },
        (payload) => {
          const row = payload.new as { status: string; expires_at: string | null };
          setRequest({ status: row.status, expires_at: row.expires_at });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, instanceId]);

  async function respond(action: "approve" | "deny") {
    setBusy(true);
    const res = await fetch(`/api/access-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (res.ok) onResponded?.();
  }

  if (loading || !request) return null;

  if (request.status === "pending") {
    return (
      <div className="flex gap-2 mt-2">
        <button onClick={() => respond("approve")} disabled={busy} className="btn-primary text-xs px-2 py-1">
          Approve
        </button>
        <button onClick={() => respond("deny")} disabled={busy} className="btn-secondary text-xs px-2 py-1">
          Deny
        </button>
      </div>
    );
  }

  if (request.status === "approved") {
    return (
      <p className="text-xs mt-1 font-mono">
        {countdown.expired ? (
          <span className="text-muted italic">Access has expired.</span>
        ) : (
          <span className="text-gold">Admin has read-only access — {countdown.label} remaining</span>
        )}
      </p>
    );
  }

  if (request.status === "denied") {
    return <p className="text-xs text-muted mt-1 italic">You denied this request.</p>;
  }

  if (request.status === "revoked") {
    return <p className="text-xs text-muted mt-1 italic">Access was closed.</p>;
  }

  return null;
}

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
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const isAnnouncement = notification.type === "announcement" && !!notification.related_id;

  function openAnnouncement() {
    setAnnouncementOpen(true);
    if (!notification.read_at) {
      const supabase = createClient();
      supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id);
    }
  }

  return (
    <div
      role={isAnnouncement ? "button" : undefined}
      tabIndex={isAnnouncement ? 0 : undefined}
      onClick={isAnnouncement ? openAnnouncement : undefined}
      onKeyDown={
        isAnnouncement
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openAnnouncement();
              }
            }
          : undefined
      }
      className={`rounded-md p-2 text-sm ${!notification.read_at ? "bg-surface-hover" : ""} ${
        isAnnouncement ? "cursor-pointer hover:bg-surface-hover" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted">{TYPE_LABEL[notification.type]}</span>
          <p className="font-medium text-foreground">{notification.title}</p>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
            aria-label="Delete notification"
            className="shrink-0 text-muted hover:text-red-400 transition-colors text-xs"
          >
            ✕
          </button>
        )}
      </div>
      {notification.body && (
        <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap">
          {notification.body}
          {isAnnouncement && <span className="text-gold"> Read more…</span>}
        </p>
      )}
      <p className="text-[10px] text-muted/70 mt-1">{new Date(notification.created_at).toLocaleString()}</p>

      {notification.type === "access_request" && notification.related_id && (
        <AccessRequestStatus requestId={notification.related_id} onResponded={onResponded} />
      )}
      {notification.type === "message" && notification.link_path && (
        <Link
          href={notification.link_path}
          onClick={onOpenLink}
          className="text-xs text-gold hover:underline mt-1 inline-block"
        >
          View
        </Link>
      )}

      {announcementOpen && notification.related_id && (
        // Stops the modal's own clicks (backdrop, close button, content)
        // from bubbling up to this card's own onClick, which would
        // otherwise immediately reopen the modal right after closing it.
        <div onClick={(e) => e.stopPropagation()}>
          <AnnouncementModal announcementId={notification.related_id} onClose={() => setAnnouncementOpen(false)} />
        </div>
      )}
    </div>
  );
}
