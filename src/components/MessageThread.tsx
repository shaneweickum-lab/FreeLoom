"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupportMessage } from "@/lib/types";

type SenderRole = "parent" | "admin";

const STOP_TYPING_AFTER_MS = 2500;
const REMOTE_TYPING_EXPIRES_MS = 4000;

function TypingDots({ fromAdmin }: { fromAdmin: boolean }) {
  return (
    <div className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
      <div className={`flex items-center gap-1 rounded-lg px-3 py-2.5 ${fromAdmin ? "bg-violet/15" : "bg-gold/15"}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce" />
      </div>
    </div>
  );
}

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
  const [myRole, setMyRole] = useState<SenderRole | null>(null);
  const [typingRole, setTypingRole] = useState<SenderRole | null>(null);
  // See useNotifications.ts for why this matters: supabase.channel() dedupes
  // by topic, so two mounted threads for the same thread would otherwise
  // silently share one channel and only one would actually receive events.
  const instanceId = useId();
  // The typing channel is intentionally shared (no instanceId) -- it needs
  // the SAME topic across the two different people's browsers so their
  // broadcasts actually reach each other. That's safe here because only one
  // MessageThread is ever mounted per browser tab at a time (MessageThreads
  // remounts on selection via `key`), unlike the bell's always-duplicated
  // mount that caused the postgres_changes bug this fix pattern guards
  // against elsewhere.
  const typingChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

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
    // Same reasoning as useNotifications.ts -- a dropped websocket here has
    // no visible sign at all, and would just look like "the other person
    // hasn't replied yet." A quiet periodic re-fetch bounds staleness.
    const interval = setInterval(load, 45_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: adminRow } = await supabase.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
      setMyRole(adminRow ? "admin" : "parent");
    });
  }, []);

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

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`typing:${threadId}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { role, isTyping } = payload as { role: SenderRole; isTyping: boolean };
        if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);
        if (!isTyping) {
          setTypingRole(null);
          return;
        }
        setTypingRole(role);
        // Self-expires in case the "stopped typing" broadcast never arrives
        // (e.g. the other tab was closed mid-keystroke).
        remoteTypingTimeoutRef.current = setTimeout(() => setTypingRole(null), REMOTE_TYPING_EXPIRES_MS);
      })
      .subscribe();
    typingChannelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [threadId]);

  const sendTypingSignal = useCallback(
    (isTyping: boolean) => {
      if (!myRole || !typingChannelRef.current) return;
      isTypingRef.current = isTyping;
      typingChannelRef.current.send({ type: "broadcast", event: "typing", payload: { role: myRole, isTyping } });
    },
    [myRole]
  );

  function handleBodyChange(value: string) {
    setBody(value);
    if (value.trim()) {
      if (!isTypingRef.current) sendTypingSignal(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => sendTypingSignal(false), STOP_TYPING_AFTER_MS);
    } else if (isTypingRef.current) {
      sendTypingSignal(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTypingSignal(false);
    setSending(true);
    setError("");
    // A network-level failure (not just a non-2xx response) must still
    // clear `sending` -- otherwise the Send button is stuck disabled on
    // "Sending…" forever with no way to retry.
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setBody("");
      load();
    } catch {
      setError("Couldn't reach the server -- try again.");
    } finally {
      setSending(false);
    }
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
        {messages.length === 0 && !typingRole && (
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
        {typingRole && <TypingDots fromAdmin={typingRole === "admin"} />}
      </div>
      <form onSubmit={handleSend} className="flex flex-col sm:flex-row gap-2">
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
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
