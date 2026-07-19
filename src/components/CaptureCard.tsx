"use client";

import { ACTIVITY_TYPES, type ActivityType } from "@/lib/types";

export type CaptureForm = { rawWordDump: string; activityType: ActivityType; sourcePlatform: string; minutes: string };

/**
 * The persistent capture affordance at the top of the record feed. "Weave
 * into a record" is the product's own intentional voice for the primary
 * action -- keep it, don't rename to something generic like "Submit".
 */
export default function CaptureCard({
  form,
  onChange,
  onSubmit,
  submitting,
  error,
}: {
  form: CaptureForm;
  onChange: (form: CaptureForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4">
      <textarea
        className="input min-h-24"
        placeholder="e.g. Spent the afternoon building automated factories in Factorio, wiring up circuit logic for the first time"
        value={form.rawWordDump}
        onChange={(e) => onChange({ ...form, rawWordDump: e.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Activity type</span>
          <select className="input" value={form.activityType} onChange={(e) => onChange({ ...form, activityType: e.target.value as ActivityType })}>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Source / platform (optional)</span>
          <input className="input" placeholder="e.g. Factorio, Recess" value={form.sourcePlatform} onChange={(e) => onChange({ ...form, sourcePlatform: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Time spent, minutes (optional)</span>
          <input type="number" min={0} className="input" value={form.minutes} onChange={(e) => onChange({ ...form, minutes: e.target.value })} />
        </label>
      </div>
      <button type="submit" className="btn-primary w-fit" disabled={submitting || !form.rawWordDump.trim()}>
        {submitting ? "Weaving…" : "Weave into a record"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
