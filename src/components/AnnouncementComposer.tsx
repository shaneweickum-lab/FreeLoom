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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Announcement title"
        disabled={busy}
        className="input"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's new…"
        rows={3}
        disabled={busy}
        className="input resize-none"
      />
      <button type="submit" disabled={busy || !title.trim() || !body.trim()} className="btn-primary w-fit">
        {busy ? "Posting…" : "Post to everyone"}
      </button>
      {status === "success" && <p className="text-xs text-gold">Posted — everyone will see it in their notifications.</p>}
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </form>
  );
}
