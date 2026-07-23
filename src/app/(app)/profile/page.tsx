"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { ProfileNote, SuggestedTrack } from "@/lib/types";
import VoiceInputButton from "@/components/VoiceInputButton";

export default function ProfilePage() {
  const router = useRouter();
  const { currentStudent } = useStudents();
  const [note, setNote] = useState<ProfileNote | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!currentStudent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("profile_notes")
      .select("*")
      .eq("student_id", currentStudent.id)
      .maybeSingle()
      .then(({ data }) => {
        setNote(data);
        setContent(data?.content ?? "");
        setLoading(false);
      });
  }, [currentStudent]);

  /**
   * Upsert on student_id rather than a manual "check, then insert-or-update"
   * — the textarea's onBlur and the Save button can both fire close
   * together (blur-then-click), and a manual check-then-write is a race:
   * both calls can see "no row yet" and both insert, leaving two rows for
   * the same student. Every later single-row update then fails forever
   * (matches more than one row). onConflict makes concurrent calls
   * collapse into one row no matter how they're timed.
   */
  async function saveContent(): Promise<ProfileNote | null> {
    if (!currentStudent) return null;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: saveError } = await supabase
      .from("profile_notes")
      .upsert(
        { student_id: currentStudent.id, content, updated_at: new Date().toISOString() },
        { onConflict: "student_id" }
      )
      .select()
      .single();
    setSaving(false);
    if (saveError) {
      setError(`Couldn't save notes: ${saveError.message}`);
      return null;
    }
    setNote(data);
    setLastSavedAt(new Date());
    return data;
  }

  async function suggestTracks() {
    if (!currentStudent || !content.trim()) return;
    setSuggesting(true);
    setError(null);
    try {
      const saved = await saveContent();
      if (!saved) return;

      const res = await fetch("/api/suggest-tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, grade_level: currentStudent.grade_level }),
      });
      if (!res.ok) throw new Error(`suggest-tracks request failed (${res.status})`);
      const { tracks } = (await res.json()) as { tracks: SuggestedTrack[] };
      const merged = [...(saved.ai_suggested_tracks ?? []), ...tracks];

      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("profile_notes")
        .update({ ai_suggested_tracks: merged })
        .eq("id", saved.id)
        .select()
        .single();
      if (updateError) throw updateError;
      setNote(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`Couldn't suggest tracks: ${message}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function setTrackStatus(index: number, status: SuggestedTrack["status"]) {
    if (!note) return;
    const updated = note.ai_suggested_tracks.map((t, i) => (i === index ? { ...t, status } : t));
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("profile_notes")
      .update({ ai_suggested_tracks: updated })
      .eq("id", note.id)
      .select()
      .single();
    if (updateError) setError(`Couldn't update that class: ${updateError.message}`);
    else if (data) setNote(data);
  }

  /** Accepting a suggested class hands off to the Learning Log to add the specific
   * activity, rather than leaving an accepted-but-empty class sitting here. */
  async function acceptTrack(index: number) {
    if (!note) return;
    const track = note.ai_suggested_tracks[index];
    await setTrackStatus(index, "accepted");
    const params = new URLSearchParams({ subject: track.subject, rationale: track.rationale });
    router.push(`/log?${params.toString()}`);
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a student from the dashboard first.</p>;
  }
  if (loading) return null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Student Profile &amp; Discovery</h1>
        <p className="text-muted text-sm">
          Describe {currentStudent.name}&apos;s hobbies, personality, and how they learn. We&apos;ll suggest
          classes tied to those interests — accept one to start logging entries for it in the Learning
          Log, or dismiss it.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <textarea
            className="input min-h-32 pr-10"
            placeholder="e.g. obsessed with dinosaurs, loves drawing, plays a lot of Minecraft, curious and hands-on, needs movement breaks, learns best by teaching someone else what they figured out"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={() => saveContent()}
          />
          <VoiceInputButton
            className="absolute bottom-2 right-2"
            onTranscript={(text) => setContent((prev) => (prev ? `${prev} ${text}` : text))}
          />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => saveContent()} className="btn-secondary" disabled={saving}>
            {saving ? "Saving…" : "Save notes"}
          </button>
          <button onClick={suggestTracks} className="btn-primary" disabled={suggesting || !content.trim()}>
            {suggesting ? "Thinking…" : "Suggest classes from interests"}
          </button>
          {!saving && lastSavedAt && (
            <span className="text-xs text-muted">Saved at {lastSavedAt.toLocaleTimeString()}</span>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {!!note?.ai_suggested_tracks?.length && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Suggested classes</h2>
          {note.ai_suggested_tracks.map((track, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 shadow-sm flex items-start justify-between gap-4 ${
                track.status === "accepted"
                  ? "border-gold bg-surface"
                  : track.status === "dismissed"
                  ? "border-border bg-surface/40 opacity-50"
                  : "border-border bg-surface"
              }`}
            >
              <div>
                <div className="font-medium">{track.subject}</div>
                <div className="text-sm text-muted">{track.rationale}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => acceptTrack(i)}
                  className={`text-xs px-2 py-1 rounded ${
                    track.status === "accepted" ? "bg-gold text-ink" : "hover:bg-surface-hover"
                  }`}
                >
                  Accept
                </button>
                <button
                  onClick={() => setTrackStatus(i, "dismissed")}
                  className={`text-xs px-2 py-1 rounded ${
                    track.status === "dismissed" ? "bg-border" : "hover:bg-surface-hover"
                  }`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
