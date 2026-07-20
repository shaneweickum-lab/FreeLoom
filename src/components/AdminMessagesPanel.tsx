"use client";

import { useState } from "react";
import MessageThread from "@/components/MessageThread";

export default function AdminMessagesPanel() {
  const [email, setEmail] = useState("");
  const [parentUserId, setParentUserId] = useState<string | null>(null);
  const [parentEmail, setParentEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/lookup-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setParentUserId(data.userId);
    setParentEmail(data.email);
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleOpen} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="parent@example.com"
          disabled={busy}
          className="input sm:w-64"
        />
        <button type="submit" disabled={busy} className="btn-primary whitespace-nowrap">
          {busy ? "Looking up…" : "Open thread"}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {parentUserId && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted font-mono">Thread with {parentEmail}</p>
          <MessageThread parentUserId={parentUserId} />
        </div>
      )}
    </div>
  );
}
