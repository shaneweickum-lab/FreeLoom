"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MessageThread from "@/components/MessageThread";
import type { SupportThread } from "@/lib/types";

/** The thread sidebar + selected conversation. Omit `parentUserId` for a
 * parent viewing their own threads; admins pass the target parent's user id.
 * Wrap the caller in <Suspense> -- this reads the `thread` query param
 * (from a notification link) via useSearchParams(). */
export default function MessageThreads({ parentUserId }: { parentUserId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ownerId, setOwnerId] = useState<string | null>(parentUserId ?? null);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const instanceId = useId();

  const load = useCallback(async () => {
    const supabase = createClient();
    let resolvedOwnerId = parentUserId ?? null;
    if (!resolvedOwnerId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      resolvedOwnerId = user?.id ?? null;
    }
    setOwnerId(resolvedOwnerId);
    if (!resolvedOwnerId) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("support_threads")
      .select("*")
      .eq("parent_user_id", resolvedOwnerId)
      .order("last_message_at", { ascending: false });
    setThreads(data ?? []);
    setLoading(false);
  }, [parentUserId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // A notification link (?thread=<id>) should jump straight to that
  // conversation once the thread list has loaded, then clear the param so
  // it doesn't re-trigger on a later re-render.
  useEffect(() => {
    if (loading) return;
    const paramThreadId = searchParams.get("thread");
    if (paramThreadId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(paramThreadId);
      router.replace(parentUserId ? `/admin/users/${parentUserId}` : "/messages");
    } else if (!selectedId && threads.length > 0) {
      setSelectedId(threads[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, threads]);

  useEffect(() => {
    if (!ownerId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`support_threads:${ownerId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_threads", filter: `parent_user_id=eq.${ownerId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as SupportThread;
            setThreads((prev) => (prev.some((t) => t.id === row.id) ? prev : [row, ...prev]));
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as SupportThread;
            setThreads((prev) => [...prev.filter((t) => t.id !== row.id), row].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)));
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            setThreads((prev) => prev.filter((t) => t.id !== oldRow.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId, instanceId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerId) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("support_threads")
      .insert({ parent_user_id: ownerId, subject: newSubject.trim() || "New conversation", created_by: user.id })
      .select("*")
      .single();
    if (!error && data) {
      setThreads((prev) => [data, ...prev]);
      setSelectedId(data.id);
      setNewSubject("");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this entire conversation? This can't be undone.")) return;
    setDeletingId(id);
    const supabase = createClient();
    const { error } = await supabase.from("support_threads").delete().eq("id", id);
    setDeletingId(null);
    if (error) return;
    setThreads((prev) => prev.filter((t) => t.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading conversations…</p>;
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="sm:w-56 shrink-0 flex flex-col gap-2">
        {creating ? (
          <form onSubmit={handleCreate} className="flex flex-col gap-1.5">
            <input
              autoFocus
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="Subject"
              className="input text-xs py-1.5"
            />
            <div className="flex gap-2 text-xs">
              <button type="submit" className="btn-primary py-1 px-2 text-xs">
                Create
              </button>
              <button type="button" onClick={() => setCreating(false)} className="text-muted hover:text-foreground">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="text-xs font-medium text-gold hover:underline text-left"
          >
            + New conversation
          </button>
        )}

        <div className="flex flex-col gap-1">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                selectedId === t.id ? "bg-surface-hover text-gold" : "text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              <button onClick={() => setSelectedId(t.id)} className="flex-1 min-w-0 text-left truncate">
                {t.subject}
              </button>
              <button
                onClick={() => handleDelete(t.id)}
                disabled={deletingId === t.id}
                aria-label={`Delete ${t.subject}`}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-red-400 transition-opacity shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          {threads.length === 0 && <p className="text-xs text-muted px-2">No conversations yet.</p>}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {selectedId ? (
          <MessageThread key={selectedId} threadId={selectedId} />
        ) : (
          <p className="text-sm text-muted">Start a conversation to reach the FreeLoom team.</p>
        )}
      </div>
    </div>
  );
}
