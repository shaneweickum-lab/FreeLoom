"use client";

import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";

type Row = { id: string; status: string; expires_at: string | null; last_viewed_at: string | null };

function isActiveRow(row: Row | undefined): row is Row & { expires_at: string } {
  // last_viewed_at is only ever set by admin_view_account() itself, the
  // moment the admin's read-only page actually loads -- so an approval
  // alone doesn't light this up, only the admin actually looking does.
  return Boolean(
    row && row.status === "approved" && row.last_viewed_at && row.expires_at && new Date(row.expires_at) > new Date()
  );
}

/** The parent-facing "someone's looking" light -- deliberately as visible
 * as Apple's camera/mic-in-use indicator, not tucked away inside a
 * notification you have to go open. Lives wherever it's rendered in the
 * nav chrome, so it's on screen no matter which page is open, and stays
 * live via Realtime so it appears and disappears immediately -- the admin
 * actually opening the view, an extension, an early close-out, or a
 * natural expiry all show up here with no refresh. */
export default function AdminAccessIndicator({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const instanceId = useId();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { data: existing } = await supabase
        .from("account_access_requests")
        .select("id, status, expires_at, last_viewed_at")
        .eq("target_user_id", uid)
        .eq("status", "approved")
        .order("responded_at", { ascending: false })
        .limit(5);
      setRows(existing ?? []);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`account_access_requests:indicator:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "account_access_requests", filter: `target_user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const row = payload.new as Row;
            setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId]);

  const active = rows.find(isActiveRow);
  const countdown = useCountdown(active?.expires_at ?? null);

  if (!active || countdown.expired) return null;

  const label = `Admin has read-only access — ${countdown.label} remaining`;

  if (compact) {
    return (
      <span role="status" title={label} aria-label={label} className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold" />
      </span>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-mono text-gold"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
      </span>
      <span className="truncate">Admin viewing — {countdown.label}</span>
    </div>
  );
}
