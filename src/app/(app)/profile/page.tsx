"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { ProfileNote, SuggestedTrack } from "@/lib/types";

export default function ProfilePage() {
  const { currentStudent } = useStudents();
  const [note, setNote] = useState<ProfileNote | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

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

  async function saveContent() {
    if (!currentStudent) return;
    setSaving(true);
    const supabase = createClient();
    if (note) {
      const { data } = await supabase
        .from("profile_notes")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", note.id)
        .select()
        .single();
      if (data) setNote(data);
    } else {
      const { data } = await supabase
        .from("profile_notes")
        .insert({ student_id: currentStudent.id, content })
        .select()
        .single();
      if (data) setNote(data);
    }
    setSaving(false);
  }

  async function suggestTracks() {
    if (!currentStudent || !content.trim()) return;
    setSuggesting(true);
    await saveContent();
    const res = await fetch("/api/suggest-tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, grade_level: currentStudent.grade_level }),
    });
    const { tracks } = (await res.json()) as { tracks: SuggestedTrack[] };
    const supabase = createClient();
    const merged = [...(note?.ai_suggested_tracks ?? []), ...tracks];
    const { data } = await supabase
      .from("profile_notes")
      .update({ ai_suggested_tracks: merged })
      .eq("student_id", currentStudent.id)
      .select()
      .single();
    if (data) setNote(data);
    setSuggesting(false);
  }

  async function setTrackStatus(index: number, status: SuggestedTrack["status"]) {
    if (!note) return;
    const updated = note.ai_suggested_tracks.map((t, i) => (i === index ? { ...t, status } : t));
    const supabase = createClient();
    const { data } = await supabase
      .from("profile_notes")
      .update({ ai_suggested_tracks: updated })
      .eq("id", note.id)
      .select()
      .single();
    if (data) setNote(data);
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }
  if (loading) return null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Student Profile &amp; Discovery</h1>
        <p className="text-muted text-sm">
          Describe {currentStudent.name}&apos;s hobbies, personality, and how they learn. We&apos;ll suggest
          subject tracks tied to those interests as a starting point you can accept, edit, or dismiss.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <textarea
          className="input min-h-32"
          placeholder="e.g. obsessed with dinosaurs, loves drawing, plays a lot of Minecraft, curious and hands-on, needs movement breaks, learns best by teaching someone else what they figured out"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={saveContent}
        />
        <div className="flex gap-2">
          <button onClick={saveContent} className="btn-secondary" disabled={saving}>
            {saving ? "Saving…" : "Save notes"}
          </button>
          <button onClick={suggestTracks} className="btn-primary" disabled={suggesting || !content.trim()}>
            {suggesting ? "Thinking…" : "Suggest tracks from interests"}
          </button>
        </div>
      </div>

      {!!note?.ai_suggested_tracks.length && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Suggested tracks</h2>
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
                  onClick={() => setTrackStatus(i, "accepted")}
                  className={`text-xs px-2 py-1 rounded ${
                    track.status === "accepted" ? "bg-gold text-white" : "hover:bg-surface-hover"
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
