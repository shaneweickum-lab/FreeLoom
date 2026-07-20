"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupportMessage } from "@/lib/types";

/** Messages within a single thread. Aligns by sender_role (parent left,
 * admin right) rather than "did the current viewer send this" -- any admin
 * can reply in the shared inbox, so aligning by role reads more sensibly
 * than aligning by exact sender identity. */
export default function MessageThread({ threadId, onCleared }: { threadId: string; onCleared?: () => void }) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  // See useNotifications.ts for why this matters: supabase.channel() dedupes
  // by topic, so two mounted threads for the same thread would otherwise
  // silently share one channel and only one would actually receive events.
  const instanceId = useId();

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("support_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    setMessages(data ?? []);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  }, [threadId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`support_messages:${threadId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as SupportMessage;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, instanceId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError("");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, body }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setBody("");
    load();
  }

  async function handleClear() {
    if (!confirm("Clear every message in this conversation? This can't be undone.")) return;
    setClearing(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("support_messages").delete().eq("thread_id", threadId);
    setClearing(false);
    if (deleteError) {
      setError("Couldn't clear this conversation.");
      return;
    }
    setMessages([]);
    onCleared?.();
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading messages…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={handleClear}
          disabled={clearing || messages.length === 0}
          className="text-xs text-muted hover:text-red-400 transition-colors disabled:opacity-40 disabled:hover:text-muted"
        >
          {clearing ? "Clearing…" : "Clear conversation"}
        </button>
      </div>
      <div className="flex flex-col gap-2 max-h-96 overflow-y-auto rounded-lg border border-navy-line bg-navy-soft p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted">
            No messages yet — write something below and the admin team will see it.
          </p>
        )}
        {messages.map((m) => {
          const fromAdmin = m.sender_role === "admin";
          return (
            <div key={m.id} className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  fromAdmin ? "bg-violet/15 text-foreground" : "bg-gold/15 text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="text-[10px] text-muted mt-1">{new Date(m.created_at).toLocaleString()}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSend} className="flex flex-col sm:flex-row gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…"
          rows={2}
          disabled={sending}
          className="input flex-1 resize-none"
        />
        <button type="submit" disabled={sending || !body.trim()} className="btn-primary whitespace-nowrap self-end">
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
