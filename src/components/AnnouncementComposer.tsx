"use client";

import { useState } from "react";

const AUDIENCE_OPTIONS = [
  { value: "everyone", label: "Everyone on FreeLoom" },
  { value: "homeschooling", label: "Homeschooling families" },
  { value: "unschooling", label: "Unschooling families" },
  { value: "wildschooling", label: "Wildschooling families" },
] as const;

export default function AnnouncementComposer() {
  const [audience, setAudience] = useState<(typeof AUDIENCE_OPTIONS)[number]["value"]>("everyone");
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
    const payload =
      audience === "everyone"
        ? { title, body, targetType: "everyone" }
        : { title, body, targetType: "schooling_type", targetSchoolingType: audience };
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

  const audienceLabel = AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? "Everyone on FreeLoom";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-navy-line bg-navy-soft p-4">
      <label className="flex items-center gap-2 text-xs">
        <span className="font-mono uppercase tracking-wide text-muted shrink-0">To</span>
        <select
          className="input py-1"
          value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          disabled={busy}
        >
          {AUDIENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
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
        {busy ? "Sending…" : `Send to ${audience === "everyone" ? "everyone" : audienceLabel.toLowerCase()}`}
      </button>
      {status === "success" && (
        <p className="text-xs text-gold">Sent — {audienceLabel.toLowerCase()} will see it in their notifications.</p>
      )}
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </form>
  );
}
