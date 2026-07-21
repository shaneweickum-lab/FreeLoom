"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BennyChat from "@/components/BennyChat";
import type { BennyConversation } from "@/lib/types";

/** The Benny conversation list + selected chat. Always "my own conversations"
 * -- unlike MessageThreads.tsx there's no admin-viewing-a-parent's case, and
 * no realtime subscription, since a Benny conversation only ever has one
 * viewer (see BennyChat.tsx). */
export default function BennyConversations() {
  const [conversations, setConversations] = useState<BennyConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("benny_conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    setConversations(data ?? []);
    setLoading(false);
    setSelectedId((prev) => prev ?? data?.[0]?.id ?? null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }
    const { data, error } = await supabase.from("benny_conversations").insert({ user_id: user.id }).select("*").single();
    setCreating(false);
    if (!error && data) {
      setConversations((prev) => [data, ...prev]);
      setSelectedId(data.id);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this conversation? This can't be undone.")) return;
    setDeletingId(id);
    const supabase = createClient();
    const { error } = await supabase.from("benny_conversations").delete().eq("id", id);
    setDeletingId(null);
    if (error) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading conversations…</p>;
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4 h-full min-h-0">
      <div className="sm:w-40 shrink-0 flex flex-col gap-2">
        <button onClick={handleCreate} disabled={creating} className="text-xs font-medium text-gold hover:underline text-left disabled:opacity-50">
          + New chat
        </button>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                selectedId === c.id ? "bg-surface-hover text-gold" : "text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              <button onClick={() => setSelectedId(c.id)} className="flex-1 min-w-0 text-left truncate">
                {c.title}
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                disabled={deletingId === c.id}
                aria-label={`Delete ${c.title}`}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-red-400 transition-opacity shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          {conversations.length === 0 && <p className="text-xs text-muted px-2">No conversations yet.</p>}
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-0">
        {selectedId ? (
          <BennyChat key={selectedId} conversationId={selectedId} />
        ) : (
          <p className="text-sm text-muted">Start a new chat to ask Benny something.</p>
        )}
      </div>
    </div>
  );
}
