"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser } from "@/lib/types";

export default function AdminUsersPanel({ admins, currentUserId }: { admins: AdminUser[]; currentUserId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMessage("");
    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErrorMessage(data.error ?? "Something went wrong.");
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function handleRemove(userId: string) {
    setBusy(true);
    setErrorMessage("");
    const res = await fetch("/api/admin/admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErrorMessage(data.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-navy-line overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-soft text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Admin since</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.user_id} className="border-t border-navy-line">
                <td className="px-4 py-2 font-mono">
                  {a.email}
                  {a.user_id === currentUserId && <span className="text-muted"> (you)</span>}
                </td>
                <td className="px-4 py-2 text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right">
                  {admins.length > 1 && (
                    <button
                      onClick={() => handleRemove(a.user_id)}
                      disabled={busy}
                      className="text-xs text-ink-soft hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
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
          {busy ? "Approving…" : "Approve as admin"}
        </button>
      </form>
      {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
    </div>
  );
}
