"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SchoolProfile } from "@/lib/types";

const SCHOOLING_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "homeschooling", label: "Homeschooling" },
  { value: "unschooling", label: "Unschooling" },
  { value: "wildschooling", label: "Wildschooling" },
] as const;

const SCHOOLING_TYPE_LABEL: Record<string, string> = {
  homeschooling: "Homeschooling",
  unschooling: "Unschooling",
  wildschooling: "Wildschooling",
};

function formFromProfile(profile: SchoolProfile | null) {
  return {
    parentName: profile?.parent_name ?? "",
    state: profile?.state ?? "",
    address: profile?.address ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    schoolingType: (profile?.schooling_type ?? "") as "" | "homeschooling" | "unschooling" | "wildschooling",
    hideStudentNames: profile?.hide_student_names ?? false,
    hideStudentBirthdates: profile?.hide_student_birthdates ?? false,
  };
}

function PencilIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Read-only display for a field -- matches AdminAccountView.tsx's own
 * read-only Field styling, since this is the same "disabled input" idiom. */
function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted text-xs">{label}</span>
      <input className="input opacity-70 cursor-not-allowed" value={value || "—"} disabled readOnly />
    </label>
  );
}

export default function AccountTab({ userId, initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  const [form, setForm] = useState(formFromProfile(initialProfile));
  // Snapshot of the last successfully-saved form -- Cancel reverts to this,
  // not the original server-rendered `initialProfile` prop, which would
  // otherwise go stale after the very first save this session.
  const [savedForm, setSavedForm] = useState(formFromProfile(initialProfile));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Independent of the edit-mode form above -- a feature switch, not
  // identifying account info, so it saves instantly on toggle (same UX as
  // NotificationsTab.tsx's checkboxes) rather than requiring edit mode + Save.
  const [bennyEnabled, setBennyEnabled] = useState(initialProfile?.benny_assistant_enabled ?? false);
  const [bennySaving, setBennySaving] = useState(false);

  async function saveBennyEnabled(next: boolean) {
    setBennyEnabled(next);
    setBennySaving(true);
    const supabase = createClient();
    await supabase.from("school_profiles").upsert({
      user_id: userId,
      benny_assistant_enabled: next,
      updated_at: new Date().toISOString(),
    });
    setBennySaving(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const supabase = createClient();

    // A partial upsert -- only touches these columns, so it can't clobber
    // the transcript page's own school_name/logo/accent/layout fields on
    // the same row (Postgres upsert only updates columns present in the
    // payload on conflict, everything else on the row is left alone).
    await supabase.from("school_profiles").upsert({
      user_id: userId,
      parent_name: form.parentName || null,
      state: form.state || null,
      address: form.address || null,
      phone: form.phone || null,
      email: form.email || null,
      schooling_type: form.schoolingType || null,
      hide_student_names: form.hideStudentNames,
      hide_student_birthdates: form.hideStudentBirthdates,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    setSaved(true);
    setSavedForm(form);
    setEditing(false);
  }

  const schoolingLabel = form.schoolingType ? SCHOOLING_TYPE_LABEL[form.schoolingType] : "Not set";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted text-sm">Your own info as a parent on this account.</p>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit account info"
            title="Edit"
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {!editing ? (
        <>
          <ReadOnlyField label="Your name" value={form.parentName} />
          <ReadOnlyField label="State" value={form.state} />
          <ReadOnlyField label="How your family learns" value={schoolingLabel} />
          <ReadOnlyField label="Address" value={form.address} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyField label="Phone" value={form.phone} />
            <ReadOnlyField label="Email" value={form.email} />
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Your name</span>
            <input
              className="input"
              value={form.parentName}
              onChange={(e) => setForm({ ...form, parentName: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">State</span>
            <input
              className="input"
              placeholder="State (e.g. CA, TX, NY)"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">How your family learns</span>
            <select
              className="input"
              value={form.schoolingType}
              onChange={(e) => setForm({ ...form, schoolingType: e.target.value as typeof form.schoolingType })}
            >
              {SCHOOLING_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-muted/70 text-[11px]">
              Lets FreeLoom send announcements just to families like yours, instead of everyone.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Address</span>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted text-xs">Phone</span>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted text-xs">Email</span>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          </div>
        </>
      )}

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            checked={form.hideStudentNames}
            disabled={!editing}
            onChange={(e) => setForm({ ...form, hideStudentNames: e.target.checked })}
          />
          <span>Hide my children&apos;s names from admin</span>
        </label>
        <span className="text-muted/70 text-[11px] pl-6 -mt-2">
          If an admin ever gets approved read-only access to help with an issue, they&apos;ll see everything else on
          the account as usual, but each student shows up as &quot;Student 1&quot;, &quot;Student 2&quot;, etc. instead
          of their real name.
        </span>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            checked={form.hideStudentBirthdates}
            disabled={!editing}
            onChange={(e) => setForm({ ...form, hideStudentBirthdates: e.target.checked })}
          />
          <span>Hide my children&apos;s birthdates from admin</span>
        </label>
        <span className="text-muted/70 text-[11px] pl-6 -mt-2">
          Same admin read-only access as above, but for birthdates -- shown as a fixed placeholder instead of the
          real date.
        </span>
      </div>

      <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-gold"
            checked={bennyEnabled}
            disabled={bennySaving}
            onChange={(e) => saveBennyEnabled(e.target.checked)}
          />
          <span className="font-medium">Benny (AI Assistant)</span>
        </label>
        <span className="text-muted/70 text-[11px]">
          Adds a chat icon to the app for asking Benny, FreeLoom&apos;s in-progress assistant, questions. Benny is
          still early -- expect a placeholder reply for now while the assistant itself is being trained.
        </span>
      </div>

      {editing && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary w-fit">
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(savedForm);
              setEditing(false);
            }}
            disabled={saving}
            className="btn-secondary w-fit"
          >
            Cancel
          </button>
        </div>
      )}
      {saved && !editing && <p className="text-xs text-gold">Saved.</p>}
    </form>
  );
}
