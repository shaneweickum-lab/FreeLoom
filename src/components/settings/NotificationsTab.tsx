"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SchoolProfile } from "@/lib/types";

const RETENTION_OPTIONS = [
  { value: "", label: "Never" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "21", label: "21 days" },
  { value: "30", label: "30 days" },
];

function formFromProfile(profile: SchoolProfile | null) {
  return {
    emailNotifyMessages: profile?.email_notify_messages ?? true,
    emailNotifyAnnouncements: profile?.email_notify_announcements ?? true,
    muteInAppMessages: profile?.mute_in_app_messages ?? false,
    muteInAppAnnouncements: profile?.mute_in_app_announcements ?? false,
    threadRetentionDays: profile?.thread_retention_days ? String(profile.thread_retention_days) : "",
  };
}

export default function NotificationsTab({ userId, initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  const [form, setForm] = useState(formFromProfile(initialProfile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(next: typeof form) {
    setForm(next);
    setSaving(true);
    setSaved(false);
    const supabase = createClient();
    await supabase.from("school_profiles").upsert({
      user_id: userId,
      email_notify_messages: next.emailNotifyMessages,
      email_notify_announcements: next.emailNotifyAnnouncements,
      mute_in_app_messages: next.muteInAppMessages,
      mute_in_app_announcements: next.muteInAppAnnouncements,
      thread_retention_days: next.threadRetentionDays ? Number(next.threadRetentionDays) : null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Email me about</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={form.emailNotifyMessages}
            disabled={saving}
            onChange={(e) => save({ ...form, emailNotifyMessages: e.target.checked })}
          />
          <span>New messages</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={form.emailNotifyAnnouncements}
            disabled={saving}
            onChange={(e) => save({ ...form, emailNotifyAnnouncements: e.target.checked })}
          />
          <span>Announcements</span>
        </label>
      </div>

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Show in my notifications inbox</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={!form.muteInAppMessages}
            disabled={saving}
            onChange={(e) => save({ ...form, muteInAppMessages: !e.target.checked })}
          />
          <span>New messages</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={!form.muteInAppAnnouncements}
            disabled={saving}
            onChange={(e) => save({ ...form, muteInAppAnnouncements: !e.target.checked })}
          />
          <span>Announcements</span>
        </label>
      </div>

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Delete inactive message threads</span>
          <select
            className="input w-fit"
            value={form.threadRetentionDays}
            disabled={saving}
            onChange={(e) => save({ ...form, threadRetentionDays: e.target.value })}
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted/70 text-[11px]">
          Any of your message threads with no new activity for this long get permanently deleted, thread and all --
          not just hidden. Checked once a day.
        </span>
      </div>

      {saved && !saving && <p className="text-xs text-gold">Saved.</p>}
    </div>
  );
}
