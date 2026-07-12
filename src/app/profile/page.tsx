"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { findDiscoverySuggestions } from "@/lib/discoveryMap";
import type { SuggestedTrack } from "@/lib/types";

export default function ProfilePage() {
  const { data, setData, hydrated } = useStore();
  const { student } = data;
  const [justSuggested, setJustSuggested] = useState(false);

  if (!hydrated) return null;

  function updateField<K extends keyof typeof student>(key: K, value: (typeof student)[K]) {
    setData((prev) => ({ ...prev, student: { ...prev.student, [key]: value } }));
  }

  function getSuggestions() {
    const suggestions = findDiscoverySuggestions(student.hobbies);
    const existingSubjects = new Set(student.suggestedTracks.map((t) => t.subjectArea));
    const newTracks: SuggestedTrack[] = suggestions
      .filter((s) => !existingSubjects.has(s.subjectArea))
      .map((s) => ({
        id: crypto.randomUUID(),
        subjectArea: s.subjectArea,
        description: s.description,
        status: "suggested",
      }));
    setData((prev) => ({
      ...prev,
      student: { ...prev.student, suggestedTracks: [...prev.student.suggestedTracks, ...newTracks] },
    }));
    setJustSuggested(true);
  }

  function setTrackStatus(id: string, status: SuggestedTrack["status"]) {
    setData((prev) => ({
      ...prev,
      student: {
        ...prev.student,
        suggestedTracks: prev.student.suggestedTracks.map((t) => (t.id === id ? { ...t, status } : t)),
      },
    }));
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Student Profile &amp; Discovery</h1>
        <p className="text-muted text-sm">
          Tell us about your child. We&apos;ll suggest subject and skill tracks tied to their
          interests &mdash; a starting point you can accept, edit, or ignore.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student name">
          <input
            className="input"
            value={student.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="e.g. Jamie Rivera"
          />
        </Field>
        <Field label="Grade level">
          <input
            className="input"
            value={student.gradeLevel}
            onChange={(e) => updateField("gradeLevel", e.target.value)}
            placeholder="e.g. 9th grade"
          />
        </Field>
      </div>

      <Field label="Hobbies &amp; interests">
        <textarea
          className="input min-h-24"
          value={student.hobbies}
          onChange={(e) => updateField("hobbies", e.target.value)}
          placeholder="e.g. obsessed with dinosaurs, loves drawing, plays a lot of Minecraft"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Personality">
          <textarea
            className="input min-h-20"
            value={student.personality}
            onChange={(e) => updateField("personality", e.target.value)}
            placeholder="e.g. curious, needs movement breaks, loves explaining things to others"
          />
        </Field>
        <Field label="How they learn best">
          <textarea
            className="input min-h-20"
            value={student.learningStyle}
            onChange={(e) => updateField("learningStyle", e.target.value)}
            placeholder="e.g. hands-on, through stories, by teaching someone else"
          />
        </Field>
      </div>

      <div>
        <button onClick={getSuggestions} className="btn-primary" disabled={!student.hobbies.trim()}>
          Suggest tracks from interests
        </button>
        {justSuggested && findDiscoverySuggestions(student.hobbies).length === 0 && (
          <p className="text-muted text-sm mt-2">
            No specific matches found yet — that&apos;s okay, keep logging activities directly.
          </p>
        )}
      </div>

      {student.suggestedTracks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Suggested tracks</h2>
          {student.suggestedTracks.map((track) => (
            <div
              key={track.id}
              className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${
                track.status === "accepted"
                  ? "border-gold bg-surface"
                  : track.status === "dismissed"
                  ? "border-border bg-surface/40 opacity-50"
                  : "border-border bg-surface"
              }`}
            >
              <div>
                <div className="font-medium">{track.subjectArea}</div>
                <div className="text-sm text-muted">{track.description}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setTrackStatus(track.id, "accepted")}
                  className={`text-xs px-2 py-1 rounded ${
                    track.status === "accepted" ? "bg-gold text-background" : "hover:bg-surface-hover"
                  }`}
                >
                  Accept
                </button>
                <button
                  onClick={() => setTrackStatus(track.id, "dismissed")}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
