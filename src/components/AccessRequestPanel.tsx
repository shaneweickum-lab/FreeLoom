"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";

type AccessRequestRow = {
  id: string;
  status: string;
  expires_at: string | null;
  requested_at: string;
  requested_by: string;
};

const EXTENSION_REASON = "Still working through the issue — requesting another hour of read-only access.";

function isActiveRow(row: AccessRequestRow | undefined): row is AccessRequestRow & { expires_at: string } {
  return Boolean(row && row.status === "approved" && row.expires_at && new Date(row.expires_at) > new Date());
}

/** The per-account "can I look at this account" status + actions, replacing
 * the old standalone email-based request form now that the admin already
 * knows exactly which account they're on. Stays live via Realtime so an
 * approval, an extension, or a close-out show up immediately without a
 * refresh -- on either side, see NotificationItem.tsx for the parent's view
 * of the same underlying row. */
export default function AccessRequestPanel({
  targetUserId,
  initialRequests,
}: {
  targetUserId: string;
  initialRequests: AccessRequestRow[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestingMoreTime, setRequestingMoreTime] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  // Bridges the gap between "the POST succeeded" and "the realtime INSERT
  // for the new row actually arrived" -- both are true statements the
  // moment the request is submitted, so there's no risk in showing this
  // immediately rather than waiting on the round trip.
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const instanceId = useId();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`account_access_requests:${targetUserId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "account_access_requests", filter: `target_user_id=eq.${targetUserId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as AccessRequestRow;
            setRequests((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
            setAwaitingResponse(false);
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as AccessRequestRow;
            setRequests((prev) => prev.map((r) => (r.id === row.id ? row : r)));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetUserId, instanceId]);

  const mine = myUserId ? requests.filter((r) => r.requested_by === myUserId) : requests;
  const sorted = [...mine].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const activeRequest = sorted.find(isActiveRow);
  const pendingRequest = awaitingResponse || sorted.some((r) => r.status === "pending");
  const countdown = useCountdown(activeRequest?.expires_at ?? null);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, reason }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setReason("");
    setAwaitingResponse(true);
  }

  async function handleRequestMoreTime() {
    setRequestingMoreTime(true);
    setError("");
    const res = await fetch("/api/admin/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, reason: EXTENSION_REASON }),
    });
    const data = await res.json();
    setRequestingMoreTime(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't request more time.");
      return;
    }
    setAwaitingResponse(true);
  }

  async function handleClose() {
    if (!activeRequest) return;
    if (!confirm("Close out your access to this account now? The parent will be notified.")) return;
    setClosing(true);
    setError("");
    const res = await fetch(`/api/access-requests/${activeRequest.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke" }),
    });
    setClosing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't close out access.");
    }
  }

  if (activeRequest) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-navy-line p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gold font-mono">
            {countdown.expired ? "Access just expired" : `Access active — ${countdown.label} remaining`}
          </span>
          <Link href={`/admin/view/${targetUserId}`} className="text-xs text-gold hover:underline whitespace-nowrap">
            View account
          </Link>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {pendingRequest ? (
            <span className="text-muted">Waiting on the parent to approve more time…</span>
          ) : (
            <button onClick={handleRequestMoreTime} disabled={requestingMoreTime} className="text-gold hover:underline disabled:opacity-50">
              {requestingMoreTime ? "Requesting…" : "Request more time"}
            </button>
          )}
          <button onClick={handleClose} disabled={closing} className="text-muted hover:text-red-400 disabled:opacity-50">
            {closing ? "Closing…" : "Close access now"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  if (pendingRequest) {
    return <p className="text-sm text-muted">Waiting on the parent to approve your request.</p>;
  }

  return (
    <form onSubmit={handleRequest} className="flex flex-col gap-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why do you need access? (shown to the parent)"
        rows={2}
        disabled={busy}
        className="input resize-none"
      />
      <button type="submit" disabled={busy || !reason.trim()} className="btn-primary w-fit text-sm">
        {busy ? "Requesting…" : "Request read-only access"}
      </button>
      <p className="text-xs text-muted">Read-only, and expires automatically 1 hour after approval.</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}
