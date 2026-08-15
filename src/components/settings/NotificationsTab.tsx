"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEffectiveTier, MAX_RETENTION_DAYS } from "@/lib/billing/tier";
import type { SchoolProfile } from "@/lib/types";
import Card from "@/components/ui/Card";

const ALL_RETENTION_OPTIONS = [
  { value: "", label: "Never", days: null as number | null },
  { value: "7", label: "7 days", days: 7 },
  { value: "14", label: "14 days", days: 14 },
  { value: "21", label: "21 days", days: 21 },
  { value: "30", label: "30 days", days: 30 },
];

function formFromProfile(profile: SchoolProfile | null) {
  return {
    emailNotifyMessages: profile?.email_notify_messages ?? true,
    emailNotifyAnnouncements: profile?.email_notify_announcements ?? true,
    muteInAppMessages: profile?.mute_in_app_messages ?? false,
    muteInAppAnnouncements: profile?.mute_in_app_announcements ?? false,
    muteInAppStreakNudges: profile?.mute_in_app_streak_nudges ?? false,
    threadRetentionDays: profile?.thread_retention_days ? String(profile.thread_retention_days) : "",
  };
}

export default function NotificationsTab({
  userId,
  initialProfile,
  isAdmin,
}: {
  userId: string;
  initialProfile: SchoolProfile | null;
  isAdmin: boolean;
}) {
  const [form, setForm] = useState(formFromProfile(initialProfile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // initialProfile is server-fetched, so tier is already known here with no
  // extra client request -- unlike StudentSwitcher.tsx, which has no
  // profile prop to read from and fetches its own. Real enforcement is a
  // DB trigger (see the billing-tiers migration); filtering these options
  // is purely so a parent never sees a choice their plan doesn't allow.
  const tier = getEffectiveTier({
    subscription_tier: initialProfile?.subscription_tier ?? "free",
    subscription_status: initialProfile?.subscription_status ?? null,
    grandfathered_until: initialProfile?.grandfathered_until ?? null,
    current_period_end: initialProfile?.current_period_end ?? null,
    isAdmin,
  });
  const maxDays = MAX_RETENTION_DAYS[tier];
  const retentionOptions = ALL_RETENTION_OPTIONS.filter((opt) => (opt.days === null ? tier === "premium" : opt.days <= maxDays));

  async function save(next: typeof form) {
    setForm(next);
    setSaving(true);
    setSaved(false);
    setError("");
    const supabase = createClient();
    const { error: saveError } = await supabase.from("school_profiles").upsert({
      user_id: userId,
      email_notify_messages: next.emailNotifyMessages,
      email_notify_announcements: next.emailNotifyAnnouncements,
      mute_in_app_messages: next.muteInAppMessages,
      mute_in_app_announcements: next.muteInAppAnnouncements,
      mute_in_app_streak_nudges: next.muteInAppStreakNudges,
      thread_retention_days: next.threadRetentionDays ? Number(next.threadRetentionDays) : null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="flat" className="flex flex-col gap-3">
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
      </Card>

      <Card variant="flat" className="flex flex-col gap-3">
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
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={!form.muteInAppStreakNudges}
            disabled={saving}
            onChange={(e) => save({ ...form, muteInAppStreakNudges: !e.target.checked })}
          />
          <span>Logging streak reminders</span>
        </label>
      </Card>

      <Card variant="flat" className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Delete inactive message threads</span>
          <select
            className="input w-fit"
            value={form.threadRetentionDays}
            disabled={saving}
            onChange={(e) => save({ ...form, threadRetentionDays: e.target.value })}
          >
            {retentionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted/70 text-[11px]">
          Any of your message threads with no new activity for this long get permanently deleted, thread and all --
          not just hidden. Checked once a day.
          {tier !== "premium" && " Longer windows (and \"Never\") are available on higher plans."}
        </span>
      </Card>

      {saved && !saving && <p className="text-xs text-gold">Saved.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
