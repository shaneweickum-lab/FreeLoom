"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { APP_VERSION } from "@/lib/appVersion";

const ABOUT_FEATURES = [
  "Learning Log with AI-assisted subject tagging and plain-language reasoning",
  "Transcript builder with GPA, letter grades, and branded PDF export",
  "Portfolio organized by class, not a folder of loose files",
  "Multi-student support — one account for your whole family",
  "Direct messaging with the FreeLoom team, organized into conversations",
  "Real-time notifications and announcements tailored to how your family learns",
];

const EMPTY_FORM = {
  parentName: "",
  state: "",
  address: "",
  phone: "",
  email: "",
  schoolingType: "" as "" | "homeschooling" | "unschooling" | "wildschooling",
  hideStudentNames: false,
};

const SCHOOLING_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "homeschooling", label: "Homeschooling" },
  { value: "unschooling", label: "Unschooling" },
  { value: "wildschooling", label: "Wildschooling" },
] as const;

export default function SettingsPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase.from("school_profiles").select("*").eq("user_id", user.id).maybeSingle();
      setForm({
        parentName: profile?.parent_name ?? "",
        state: profile?.state ?? "",
        address: profile?.address ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
        schoolingType: profile?.schooling_type ?? "",
        hideStudentNames: profile?.hide_student_names ?? false,
      });
      setLoading(false);
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    // A partial upsert -- only touches these columns, so it can't clobber
    // the transcript page's own school_name/logo/accent/layout fields on
    // the same row (Postgres upsert only updates columns present in the
    // payload on conflict, everything else on the row is left alone).
    await supabase.from("school_profiles").upsert({
      user_id: user.id,
      parent_name: form.parentName || null,
      state: form.state || null,
      address: form.address || null,
      phone: form.phone || null,
      email: form.email || null,
      schooling_type: form.schoolingType || null,
      hide_student_names: form.hideStudentNames,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    setSaved(true);
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div>
        <h1 className="font-serif text-2xl font-bold">Settings</h1>
        <p className="text-muted text-sm mt-1">Your own info as a parent on this account.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">Your name</span>
          <input
            className="input"
            value={form.parentName}
            onChange={(e) => {
              setForm({ ...form, parentName: e.target.value });
              setSaved(false);
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">State</span>
          <input
            className="input"
            placeholder="State (e.g. CA, TX, NY)"
            value={form.state}
            onChange={(e) => {
              setForm({ ...form, state: e.target.value });
              setSaved(false);
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">How your family learns</span>
          <select
            className="input"
            value={form.schoolingType}
            onChange={(e) => {
              setForm({ ...form, schoolingType: e.target.value as typeof form.schoolingType });
              setSaved(false);
            }}
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

        <div className="rounded-lg border border-navy-line p-3 flex flex-col gap-1">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              checked={form.hideStudentNames}
              onChange={(e) => {
                setForm({ ...form, hideStudentNames: e.target.checked });
                setSaved(false);
              }}
            />
            <span>Hide my children&apos;s names from admin</span>
          </label>
          <span className="text-muted/70 text-[11px] pl-6">
            If an admin ever gets approved read-only access to help with an issue, they&apos;ll see everything else on
            the account as usual, but each student shows up as &quot;Student 1&quot;, &quot;Student 2&quot;, etc. instead
            of their real name.
          </span>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted text-xs">Address</span>
          <input
            className="input"
            value={form.address}
            onChange={(e) => {
              setForm({ ...form, address: e.target.value });
              setSaved(false);
            }}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Phone</span>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => {
                setForm({ ...form, phone: e.target.value });
                setSaved(false);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">Email</span>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => {
                setForm({ ...form, email: e.target.value });
                setSaved(false);
              }}
            />
          </label>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-fit">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <p className="text-xs text-gold">Saved.</p>}
      </form>

      <div className="rounded-lg border border-navy-line p-4 flex flex-col gap-3 mt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-bold">About FreeLoom</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold font-mono">
            v{APP_VERSION}
          </span>
        </div>
        <p className="text-sm text-muted">
          A transcript builder and record-keeper for alternative schooling families — here&apos;s what&apos;s in it so far:
        </p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted list-disc list-inside">
          {ABOUT_FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
