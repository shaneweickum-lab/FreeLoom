"use client";

import { useEffect, useMemo, useState } from "react";
import type { PipelineClass, PipelineEntry } from "@/lib/types";

type ClassWithEntries = PipelineClass & { entries: PipelineEntry[] };

/** Lets a parent pick exactly which accepted entries go into the exported
 * PDF -- defaults to everything selected (the common case is "export the
 * whole portfolio"), rather than starting empty and making every download
 * begin with a full select-all click. */
export default function PortfolioPdfModal({
  studentId,
  classes,
  onClose,
}: {
  studentId: string;
  classes: ClassWithEntries[];
  onClose: () => void;
}) {
  const allEntryIds = useMemo(() => classes.flatMap((c) => c.entries.map((e) => e.id)), [classes]);
  const [selected, setSelected] = useState<Set<string>>(new Set(allEntryIds));
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function toggleEntry(entryId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function toggleClass(cls: ClassWithEntries) {
    const classEntryIds = cls.entries.map((e) => e.id);
    const allSelected = classEntryIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      classEntryIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch("/api/portfolio-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, entryIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't generate that PDF -- try again.");
        setDownloading(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filenameMatch = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameMatch?.[1] ?? "portfolio.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      setError("Couldn't reach the server -- try again.");
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-deep/70 p-4 pt-16 sm:pt-24">
      <div aria-hidden onClick={onClose} className="fixed inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose entries to download as PDF"
        className="relative w-full max-w-lg rounded-lg border border-navy-line bg-navy-soft p-5 shadow-lg flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-bold text-foreground">Download portfolio as PDF</h2>
            <p className="text-xs text-muted mt-1">Choose which entries to include -- everything&apos;s selected by default.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-foreground transition-colors shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          {classes.map((cls) => {
            const classEntryIds = cls.entries.map((e) => e.id);
            const allSelected = classEntryIds.every((id) => selected.has(id));
            return (
              <div key={cls.id} className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => toggleClass(cls)}
                    className="h-4 w-4 shrink-0 accent-gold"
                  />
                  {cls.title}
                </label>
                <div className="flex flex-col gap-1.5 pl-6">
                  {cls.entries.map((entry) => (
                    <label key={entry.id} className="flex items-start gap-2 text-xs text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggleEntry(entry.id)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-gold"
                      />
                      <span>
                        {entry.final_description || "Untitled entry"}{" "}
                        <span className="text-muted/70">— {new Date(entry.created_at).toLocaleDateString()}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleDownload}
            disabled={selected.size === 0 || downloading}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {downloading ? "Generating…" : `Download PDF (${selected.size} selected)`}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" disabled={downloading}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
