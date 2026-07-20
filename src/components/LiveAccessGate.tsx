"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCountdown } from "@/lib/useCountdown";

/** Wraps the read-only account mirror so it closes out live -- an early
 * "Close access now" from the family page, or the hour simply running out
 * while this page is still open, immediately swaps the data out for an
 * "Access closed" message instead of leaving stale data on screen until a
 * manual refresh. */
export default function LiveAccessGate({
  requestId,
  initialExpiresAt,
  children,
}: {
  requestId: string;
  initialExpiresAt: string;
  children: ReactNode;
}) {
  const [closedEarly, setClosedEarly] = useState(false);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const instanceId = useId();
  const countdown = useCountdown(closedEarly ? null : expiresAt);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`account_access_requests:view:${requestId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "account_access_requests", filter: `id=eq.${requestId}` },
        (payload) => {
          const row = payload.new as { status: string; expires_at: string | null };
          if (row.status !== "approved") {
            setClosedEarly(true);
          } else if (row.expires_at) {
            setExpiresAt(row.expires_at);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, instanceId]);

  if (closedEarly || countdown.expired) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-xl font-bold">Access closed</h2>
        <p className="text-sm text-muted">
          {closedEarly
            ? "This access was closed early."
            : "This access has expired."}{" "}
          Request access again from the family&apos;s page if you still need it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <span className="text-xs font-mono text-gold">Access active — {countdown.label} remaining</span>
      </div>
      {children}
    </div>
  );
}
