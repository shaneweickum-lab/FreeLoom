"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const EMPTY_FORM = {
  parentName: "",
  state: "",
  address: "",
  phone: "",
  email: "",
};

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
    </div>
  );
}
