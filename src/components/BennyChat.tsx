"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BennyMessage } from "@/lib/types";

/** "Benny is thinking" -- same bounce-dot animation as MessageThread.tsx's
 * TypingDots, adapted for a single always-left-aligned assistant. */
function ThinkingDots() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg px-3 py-2.5 bg-violet/15">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce" />
      </div>
    </div>
  );
}

/** Messages within a single Benny conversation. Unlike MessageThread.tsx
 * (which needs a realtime subscription so two different people's browsers
 * stay in sync), a Benny conversation only ever has one viewer -- the
 * owning user -- so sent/received messages are just appended to local state
 * directly from the API response, no postgres_changes channel needed. */
export default function BennyChat({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<BennyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("benny_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages(data ?? []);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError("");
    setBody("");
    const res = await fetch("/api/benny/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, body: trimmed }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading messages…</p>;
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div ref={scrollRef} className="flex-1 min-h-0 flex flex-col justify-end gap-2 overflow-y-auto rounded-lg border border-navy-line bg-navy-soft p-3">
        {messages.length === 0 && !sending && (
          <p className="text-sm text-muted text-center">Ask Benny anything to get started.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-gold/15 text-foreground" : "bg-violet/15 text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          </div>
        ))}
        {sending && <ThinkingDots />}
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ask Benny…"
          rows={2}
          disabled={sending}
          className="input flex-1 resize-none"
        />
        <button type="submit" disabled={sending || !body.trim()} className="btn-primary whitespace-nowrap self-end">
          {sending ? "Thinking…" : "Send"}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-muted/70 text-center">Benny is AI and can make mistakes.</p>
    </div>
  );
}
