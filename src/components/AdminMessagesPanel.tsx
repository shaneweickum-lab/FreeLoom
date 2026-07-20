"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MessageThread from "@/components/MessageThread";

export default function AdminMessagesPanel() {
  return (
    <Suspense fallback={null}>
      <AdminMessagesPanelInner />
    </Suspense>
  );
}

function AdminMessagesPanelInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [parentUserId, setParentUserId] = useState<string | null>(null);
  const [parentEmail, setParentEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openThread = useCallback(async (lookupEmail: string) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/lookup-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lookupEmail }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setParentUserId(data.userId);
    setParentEmail(data.email);
  }, []);

  useEffect(() => {
    // A "New message from <email>" notification links here with the
    // sender's email so clicking it jumps straight to their thread instead
    // of leaving the admin to guess who to look up.
    const threadEmail = searchParams.get("thread_email");
    if (!threadEmail) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(threadEmail);
    openThread(threadEmail);
    router.replace("/admin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    await openThread(email);
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
