"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { ChatConversation, ChatMessage } from "@/lib/types";

function formatConversationLabel(c: ChatConversation) {
  if (c.title) return c.title;
  return new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type ToolUseBlock = { type: "tool_use"; name: string; input: Record<string, unknown> };
type TextBlock = { type: "text"; text: string };

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as { type?: string }).type === "text";
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return !!block && typeof block === "object" && (block as { type?: string }).type === "tool_use";
}

function truncate(text: string, max = 60) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "create_learning_log":
      return `📋 Logging: "${truncate(String(input.raw_description ?? ""))}"`;
    case "approve_course":
      return `✅ Approving a course${input.course_title ? ` (edited to "${input.course_title}")` : ""}`;
    case "reject_course":
      return "🚫 Rejecting a course";
    case "update_student_profile":
      return "✏️ Updating profile";
    case "save_discovery_notes":
      return "📝 Saving discovery notes";
    case "suggest_tracks_from_notes":
      return "💡 Suggesting subject tracks";
    case "update_track_status":
      return `🔖 Marking a track as ${input.status ?? "updated"}`;
    case "generate_transcript":
      return "📄 Generating a transcript";
    default:
      return `🔧 ${name}`;
  }
}

export default function AssistantChat({ compact = false }: { compact?: boolean }) {
  const { currentStudent } = useStudents();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!currentStudent) {
      setConversations([]);
      setConversationId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_conversations")
      .select("*")
      .eq("student_id", currentStudent.id)
      .order("updated_at", { ascending: false });
    let list = (data as ChatConversation[]) || [];
    if (list.length === 0) {
      const { data: created } = await supabase
        .from("chat_conversations")
        .insert({ student_id: currentStudent.id })
        .select()
        .single();
      if (created) list = [created as ChatConversation];
    }
    setConversations(list);
    setConversationId(list[0]?.id ?? null);
  }, [currentStudent]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setMessages((data as ChatMessage[]) || []);
        setLoading(false);
      });
  }, [conversationId]);

  async function loadHistory() {
    if (!conversationId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages((data as ChatMessage[]) || []);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function startNewChat() {
    if (!currentStudent) return;
    setHistoryOpen(false);
    const supabase = createClient();
    const { data: created } = await supabase
      .from("chat_conversations")
      .insert({ student_id: currentStudent.id })
      .select()
      .single();
    if (!created) return;
    setConversations((prev) => [created as ChatConversation, ...prev]);
    setConversationId(created.id);
    setError(null);
    setQuotaExceeded(false);
  }

  function switchConversation(id: string) {
    setHistoryOpen(false);
    setError(null);
    setQuotaExceeded(false);
    setConversationId(id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !conversationId || !input.trim() || sending) return;
    setSending(true);
    setError(null);
    setQuotaExceeded(false);
    const message = input.trim();
    setInput("");

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: currentStudent.id, conversation_id: conversationId, message }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.quota_exceeded) {
          setQuotaExceeded(true);
          setInput(message);
        } else {
          setError(body.error || "The assistant hit an error.");
        }
      }
      await loadHistory();
      await loadConversations();
    } catch {
      setError("Couldn't reach the assistant — try again.");
    } finally {
      setSending(false);
    }
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }

  return (
    <div className={`flex flex-col h-full min-h-0 ${compact ? "gap-3" : "gap-6"}`}>
      {!compact && (
        <div>
          <h1 className="text-2xl font-bold mb-1">Assistant</h1>
          <p className="text-muted text-sm">
            Talk through {currentStudent.name}&apos;s learning out loud — the assistant can log activities, approve
            or fix courses, update the profile, and generate a transcript for you. It can&apos;t upload photos (use
            the Portfolio Builder for that) or add/remove children (use the Dashboard).
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="relative">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-xs text-muted hover:text-foreground px-2 py-1 rounded-md hover:bg-surface-hover"
          >
            🕐 {conversations.length > 1 ? `${conversations.length} chats` : "History"} ▾
          </button>
          {historyOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => switchConversation(c.id)}
                  className={`w-full text-left px-3 py-2 text-xs truncate hover:bg-surface-hover ${
                    c.id === conversationId ? "text-gold" : "text-foreground"
                  }`}
                >
                  {formatConversationLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={startNewChat} className="text-xs text-muted hover:text-foreground px-2 py-1 rounded-md hover:bg-surface-hover">
          + New chat
        </button>
      </div>

      <div
        className={`flex-1 overflow-y-auto rounded-lg border border-border bg-surface flex flex-col gap-4 ${
          compact ? "p-3" : "p-4"
        }`}
      >
        {loading && <p className="text-muted text-sm">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-muted text-sm">
            {`Say something like “${currentStudent.name} spent an hour building redstone circuits in Minecraft” to get started.`}
          </p>
        )}
        {messages
          .filter((m) => m.kind !== "tool_bridge")
          .map((m) => {
            const blocks = m.content as unknown[];
            const text = blocks.filter(isTextBlock).map((b) => b.text).join("\n\n");
            const toolUses = blocks.filter(isToolUseBlock);
            const isUser = m.kind === "user";
            return (
              <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2 text-sm flex flex-col gap-2 ${
                    isUser ? "bg-gold text-background" : "bg-black/20 border border-border"
                  }`}
                >
                  {text && <p className="whitespace-pre-wrap">{text}</p>}
                  {toolUses.map((t, i) => (
                    <div key={i} className="text-xs text-muted italic">
                      {describeToolUse(t.name, t.input)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      {quotaExceeded && (
        <div className="rounded-md border border-gold/40 bg-surface px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span>You&apos;ve used all of this month&apos;s assistant actions for your plan.</span>
          <Link href="/billing" className="text-gold shrink-0 hover:underline">
            View plans
          </Link>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="input"
          placeholder={compact ? "Ask the assistant…" : `Tell the assistant about ${currentStudent.name}'s day…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <button type="submit" className="btn-primary shrink-0" disabled={sending || !input.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
