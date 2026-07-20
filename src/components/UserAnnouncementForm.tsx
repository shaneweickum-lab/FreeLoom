"use client";

import { useState } from "react";

/** A one-off "email" to a single account -- distinct from AnnouncementComposer
 * (everyone / a schooling-type group) since this always targets exactly the
 * one family whose admin page it's embedded in. */
export default function UserAnnouncementForm({ targetUserId, targetLabel }: { targetUserId: string; targetLabel: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("idle");
    setErrorMessage("");
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, targetType: "user", targetUserId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setStatus("error");
      setErrorMessage(data.error ?? "Something went wrong.");
      return;
    }
    setStatus("success");
    setTitle("");
    setBody("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-navy-line bg-navy-soft p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono uppercase tracking-wide text-muted">To</span>
        <span className="text-foreground">{targetLabel}</span>
      </div>
      <div className="border-t border-navy-line" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Subject"
        disabled={busy}
        className="input font-medium"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a personal note…"
        rows={4}
        disabled={busy}
        className="input resize-none"
      />
      <button type="submit" disabled={busy || !title.trim() || !body.trim()} className="btn-primary w-fit">
        {busy ? "Sending…" : "Send"}
      </button>
      {status === "success" && <p className="text-xs text-gold">Sent.</p>}
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </form>
  );
}
