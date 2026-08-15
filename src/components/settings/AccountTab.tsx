"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BENNY_ASSISTANT_MODE_LAUNCHED, isBennyAvailable } from "@/lib/billing/tier";
import { meetsMinimumStrength } from "@/lib/passwordStrength";
import type { SchoolProfile } from "@/lib/types";
import Card from "@/components/ui/Card";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";

const SCHOOLING_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "homeschooling", label: "Homeschooling" },
  { value: "unschooling", label: "Unschooling" },
  { value: "wildschooling", label: "Wildschooling" },
  { value: "alternative_schooling", label: "Alternative Schooling" },
  { value: "private_schooling", label: "Private Schooling" },
] as const;

const SCHOOLING_TYPE_LABEL: Record<string, string> = {
  homeschooling: "Homeschooling",
  unschooling: "Unschooling",
  wildschooling: "Wildschooling",
  alternative_schooling: "Alternative Schooling",
  private_schooling: "Private Schooling",
};

function formFromProfile(profile: SchoolProfile | null) {
  return {
    parentName: profile?.parent_name ?? "",
    state: profile?.state ?? "",
    address: profile?.address ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    schoolingType: (profile?.schooling_type ?? "") as
      | ""
      | "homeschooling"
      | "unschooling"
      | "wildschooling"
      | "alternative_schooling"
      | "private_schooling",
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

export default function AccountTab({
  userId,
  isOwner,
  initialProfile,
  isAdmin,
  authEmail,
}: {
  userId: string;
  /** Whether the signed-in user is the household's literal owner --
   * account deletion stays owner-only even for an otherwise full-access
   * accepted guardian (see household.ts's own doc comment). */
  isOwner: boolean;
  initialProfile: SchoolProfile | null;
  isAdmin: boolean;
  /** The real sign-in email (auth.users), distinct from form.email above
   * (school_profiles' contact-email field) -- changing one has no effect
   * on the other. */
  authEmail: string | null;
}) {
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

  const [authEmailEditing, setAuthEmailEditing] = useState(false);
  const [newAuthEmail, setNewAuthEmail] = useState(authEmail ?? "");
  const [authEmailSaving, setAuthEmailSaving] = useState(false);
  const [authEmailNotice, setAuthEmailNotice] = useState("");
  const [authEmailError, setAuthEmailError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const bennyAvailable = isBennyAvailable({
    subscription_tier: initialProfile?.subscription_tier ?? "free",
    subscription_status: initialProfile?.subscription_status ?? null,
    grandfathered_until: initialProfile?.grandfathered_until ?? null,
    current_period_end: initialProfile?.current_period_end ?? null,
    benny_trial_ends_at: initialProfile?.benny_trial_ends_at ?? null,
    isAdmin,
  });
  const bennyLocked = !bennyAvailable;
  const bennyOnTrial =
    bennyAvailable &&
    initialProfile?.subscription_tier === "free" &&
    !!initialProfile?.benny_trial_ends_at &&
    new Date(initialProfile.benny_trial_ends_at) > new Date();

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

  async function handleChangeAuthEmail(e: React.FormEvent) {
    e.preventDefault();
    setAuthEmailError("");
    setAuthEmailNotice("");
    setAuthEmailSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email: newAuthEmail });
    setAuthEmailSaving(false);
    if (error) {
      setAuthEmailError(error.message);
      return;
    }
    // Supabase confirms an email change via a link (to the new address,
    // and to the old one too if "secure email change" is on) -- the
    // change isn't live until that's clicked, so nothing here has
    // actually taken effect yet.
    setAuthEmailNotice("Check your inbox to confirm this change -- it won't take effect until you click the link.");
    setAuthEmailEditing(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSaved(false);
    if (newPassword !== confirmNewPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    if (!meetsMinimumStrength(newPassword)) {
      setPasswordError("Choose a stronger password -- add more length or mix in a number/symbol.");
      return;
    }
    setPasswordSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) {
      setPasswordError(error.message);
      return;
    }
    setPasswordSaved(true);
    setNewPassword("");
    setConfirmNewPassword("");
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? "Something went wrong.");
        setDeleting(false);
        return;
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch {
      setDeleteError("Couldn't reach the server -- try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
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

      <Card variant="flat" className="flex flex-col gap-3">
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
      </Card>

      {BENNY_ASSISTANT_MODE_LAUNCHED && (
        <Card variant="flat" className="flex flex-col gap-3">
          <label className={`flex items-center gap-2 text-sm ${bennyLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-gold"
              checked={bennyEnabled && !bennyLocked}
              disabled={bennySaving || bennyLocked}
              onChange={(e) => saveBennyEnabled(e.target.checked)}
            />
            <span className="font-medium">Benny (AI Assistant)</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold font-mono">
              Beta
            </span>
          </label>
          <span className="text-muted/70 text-[11px]">
            {bennyLocked ? (
              <>Available on Pro and Premium plans -- see the Billing tab to upgrade.</>
            ) : (
              <>
                Adds a chat icon to the app for asking Benny, FreeLoom&apos;s in-house assistant, questions. Benny is AI
                and can make mistakes.
                {bennyOnTrial && initialProfile?.benny_trial_ends_at && (
                  <>
                    {" "}
                    Free trial active until{" "}
                    {new Date(initialProfile.benny_trial_ends_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                    .
                  </>
                )}
              </>
            )}
          </span>
        </Card>
      )}

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

    <Card variant="flat" className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium text-sm">Login email</h3>
        <p className="text-muted/70 text-[11px]">
          What you sign in with -- separate from the contact email above, which is just what shows up on
          announcements.
        </p>
      </div>
      {!authEmailEditing ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{authEmail ?? "—"}</span>
          <button
            type="button"
            onClick={() => {
              setNewAuthEmail(authEmail ?? "");
              setAuthEmailEditing(true);
              setAuthEmailError("");
              setAuthEmailNotice("");
            }}
            className="btn-secondary text-xs shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        <form onSubmit={handleChangeAuthEmail} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">New email</span>
            <input
              type="email"
              required
              className="input"
              value={newAuthEmail}
              onChange={(e) => setNewAuthEmail(e.target.value)}
            />
          </label>
          {authEmailError && <p className="text-xs text-red-400">{authEmailError}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={authEmailSaving} className="btn-primary text-sm w-fit">
              {authEmailSaving ? "Sending…" : "Send confirmation"}
            </button>
            <button
              type="button"
              onClick={() => setAuthEmailEditing(false)}
              disabled={authEmailSaving}
              className="btn-secondary text-sm w-fit"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {authEmailNotice && <p className="text-xs text-gold">{authEmailNotice}</p>}
    </Card>

    <Card variant="flat" className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium text-sm">Change password</h3>
        <p className="text-muted/70 text-[11px]">Set a new password for signing in.</p>
      </div>
      <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">New password</span>
          <input
            type="password"
            required
            minLength={8}
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <PasswordStrengthMeter password={newPassword} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">Confirm new password</span>
          <input
            type="password"
            required
            minLength={8}
            className="input"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
          />
        </label>
        {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
        {passwordSaved && <p className="text-xs text-gold">Password updated.</p>}
        <button type="submit" disabled={passwordSaving} className="btn-primary text-sm w-fit">
          {passwordSaving ? "Saving…" : "Update password"}
        </button>
      </form>
    </Card>

    <Card variant="flat" className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium text-sm">Your data</h3>
        <p className="text-muted/70 text-[11px]">
          Download everything FreeLoom has stored for your account -- profile, students, entries, transcripts,
          notifications, and messages -- as a JSON file.
        </p>
      </div>
      <a href="/api/account/export" className="btn-secondary w-fit text-sm">
        Download my data
      </a>
    </Card>

    {isOwner && (
    <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3 flex flex-col gap-3">
      <div>
        <h3 className="font-medium text-sm text-red-400">Delete account</h3>
        <p className="text-muted/70 text-[11px]">
          Permanently deletes your account and everything in it -- your profile, students, entries, transcripts,
          and messages. This can&apos;t be undone.
        </p>
      </div>
      {!confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="btn-secondary w-fit text-sm border-red-900/50 text-red-400 hover:bg-red-950/20"
        >
          Delete my account
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Type DELETE to confirm</span>
            <input
              className="input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
            />
          </label>
          {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteConfirmText !== "DELETE" || deleting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors disabled:opacity-50 w-fit"
            >
              {deleting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                setDeleteConfirmText("");
                setDeleteError("");
              }}
              disabled={deleting}
              className="btn-secondary w-fit text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
    )}
    </div>
  );
}
