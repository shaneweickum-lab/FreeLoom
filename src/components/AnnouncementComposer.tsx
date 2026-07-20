"use client";

import { useState } from "react";

export default function AnnouncementComposer() {
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
      body: JSON.stringify({ title, body }),
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
        <span className="text-foreground">Everyone on FreeLoom</span>
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
        placeholder="Write your update…"
        rows={6}
        disabled={busy}
        className="input resize-none"
      />
      <button type="submit" disabled={busy || !title.trim() || !body.trim()} className="btn-primary w-fit">
        {busy ? "Sending…" : "Send to everyone"}
      </button>
      {status === "success" && <p className="text-xs text-gold">Sent — everyone will see it in their notifications.</p>}
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </form>
  );
}
