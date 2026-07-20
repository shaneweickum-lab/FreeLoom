"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";

/** Shared by the bell dropdown and the full /notifications inbox -- fetch
 * once, then stay live via a postgres_changes subscription scoped to the
 * current user's own rows (RLS still applies to realtime, but the filter
 * needs a literal id, not auth.uid(), hence the getUser() call here). */
export function useNotifications(limit: number) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    setNotifications(data ?? []);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (!userId || cancelled) return;

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as AppNotification;
              setNotifications((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]));
            } else if (payload.eventType === "UPDATE") {
              const row = payload.new as AppNotification;
              setNotifications((prev) => prev.map((n) => (n.id === row.id ? row : n)));
            } else if (payload.eventType === "DELETE") {
              const oldRow = payload.old as { id: string };
              setNotifications((prev) => prev.filter((n) => n.id !== oldRow.id));
            }
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const supabase = createClient();
    const readAt = new Date().toISOString();
    await supabase.from("notifications").update({ read_at: readAt }).in("id", ids);
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: readAt } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    // access_request notifications are only ever "read" by actually being
    // responded to (see NotificationBell/notifications inbox) -- a blanket
    // mark-all-read must not touch those, or the UI would show them as
    // resolved when they aren't.
    const ids = notifications.filter((n) => n.type !== "access_request" && !n.read_at).map((n) => n.id);
    return markRead(ids);
  }, [notifications, markRead]);

  const remove = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from("notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, loading, markRead, markAllRead, remove, reload: load };
}
