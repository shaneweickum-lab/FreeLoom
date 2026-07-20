"use client";

import { useState } from "react";

export default function AccessRequestForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("idle");
    setErrorMessage("");
    const res = await fetch("/api/admin/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, reason }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setStatus("error");
      setErrorMessage(data.error ?? "Something went wrong.");
      return;
    }
    setStatus("success");
    setEmail("");
    setReason("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="parent@example.com"
        disabled={busy}
        className="input sm:w-64"
      />
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why do you need access? (shown to the parent)"
        rows={2}
        disabled={busy}
        className="input resize-none"
      />
      <button type="submit" disabled={busy || !email.trim() || !reason.trim()} className="btn-primary w-fit">
        {busy ? "Requesting…" : "Request account access"}
      </button>
      <p className="text-xs text-muted">
        Read-only, and expires automatically after 1 hour once approved — the parent has to say yes first.
      </p>
      {status === "success" && <p className="text-xs text-gold">Request sent — waiting on the parent to respond.</p>}
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </form>
  );
}
