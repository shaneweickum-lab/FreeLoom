"use client";

import Link from "next/link";
import { useState } from "react";

type ExistingRequest = { id: string; status: string; expires_at: string | null; requested_at: string } | null;

/** The per-account "can I look at this account" status + action, replacing
 * the old standalone email-based request form now that the admin already
 * knows exactly which account they're on. */
export default function AccessRequestPanel({
  targetUserId,
  initialRequest,
}: {
  targetUserId: string;
  initialRequest: ExistingRequest;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isActive = Boolean(request?.status === "approved" && request.expires_at && new Date(request.expires_at) > new Date());
  const isPending = request?.status === "pending";

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
    setRequest({ id: "pending", status: "pending", expires_at: null, requested_at: new Date().toISOString() });
    setReason("");
  }

  if (isActive && request?.expires_at) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-navy-line p-3 text-sm">
        <span className="text-gold">Access active until {new Date(request.expires_at).toLocaleTimeString()}</span>
        <Link href={`/admin/view/${targetUserId}`} className="text-xs text-gold hover:underline whitespace-nowrap">
          View account
        </Link>
      </div>
    );
  }

  if (isPending) {
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
