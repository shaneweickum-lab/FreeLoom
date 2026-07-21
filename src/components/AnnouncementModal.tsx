"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AnnouncementPost } from "@/lib/types";

/** Opened from a notification of type "announcement" -- the notification row
 * only carries a 140-char excerpt (see the fanout in
 * api/admin/announcements/route.ts), so this fetches the full announcement
 * by id and renders it like an opened email: full title, full body, posted
 * date. Reads `announcements` directly with the session client, gated by
 * that table's own audience-targeted RLS select policy (everyone / a single
 * user / a schooling-type group) -- no API route needed, and no need to
 * duplicate the targeting logic here. */
export default function AnnouncementModal({
  announcementId,
  onClose,
}: {
  announcementId: string;
  onClose: () => void;
}) {
  const [announcement, setAnnouncement] = useState<AnnouncementPost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("announcements")
      .select("*")
      .eq("id", announcementId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // A null row here without a thrown error almost always means RLS
        // filtered it out (zero rows matched the policy), not that the row
        // was deleted -- log it so a permissions regression is visible in
        // the console instead of silently looking identical to "deleted."
        if (error) console.error("announcement fetch error:", error);
        setAnnouncement(data);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-deep/70 p-4 pt-16 sm:pt-24">
      <div aria-hidden onClick={onClose} className="fixed inset-0" />
      <div className="relative w-full max-w-lg rounded-lg border border-navy-line bg-navy-soft p-5 shadow-lg">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-muted hover:text-foreground transition-colors"
        >
          ✕
        </button>

        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && !announcement && (
          <p className="text-sm text-muted">This announcement is no longer available.</p>
        )}

        {announcement && (
          <>
            <span className="text-[10px] font-mono uppercase tracking-wide text-muted">Announcement</span>
            <h2 className="font-serif text-xl font-bold text-foreground mt-1 pr-6">{announcement.title}</h2>
            <p className="text-xs text-muted mt-1">{new Date(announcement.created_at).toLocaleString()}</p>
            <p className="text-sm text-foreground mt-4 whitespace-pre-wrap">{announcement.body}</p>
          </>
        )}
      </div>
    </div>
  );
}
