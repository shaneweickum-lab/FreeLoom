"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { PortfolioItem } from "@/lib/types";

export default function PortfolioPage() {
  const { data, setData, hydrated } = useStore();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [courseId, setCourseId] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  if (!hydrated) return null;

  function handleFile(file: File | undefined) {
    if (!file) {
      setImageDataUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const item: PortfolioItem = {
      id: crypto.randomUUID(),
      courseId: courseId || null,
      title,
      note,
      imageDataUrl,
      date: new Date().toISOString().slice(0, 10),
    };
    setData((prev) => ({ ...prev, portfolioItems: [item, ...prev.portfolioItems] }));
    setTitle("");
    setNote("");
    setCourseId("");
    setImageDataUrl(null);
  }

  function deleteItem(id: string) {
    setData((prev) => ({ ...prev, portfolioItems: prev.portfolioItems.filter((p) => p.id !== id) }));
  }

  function courseTitleFor(id: string | null) {
    if (!id) return null;
    return data.courses.find((c) => c.id === id)?.title ?? null;
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Portfolio Builder</h1>
        <p className="text-muted text-sm">
          Attach work samples, photos, or writing to back up the transcript.
        </p>
      </div>

      <form onSubmit={addItem} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Title (e.g. Factorio factory blueprint)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">Not linked to a course</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="input min-h-20"
          placeholder="Notes about this work sample"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="text-sm text-muted"
          />
          <button type="submit" className="btn-primary ml-auto" disabled={!title.trim()}>
            Add to portfolio
          </button>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.portfolioItems.length === 0 && (
          <p className="text-muted text-sm sm:col-span-2">No portfolio items yet.</p>
        )}
        {data.portfolioItems.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-2">
            {item.imageDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageDataUrl} alt={item.title} className="rounded-md max-h-48 object-cover w-full" />
            )}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted">{item.date}</div>
              </div>
              <button onClick={() => deleteItem(item.id)} className="text-xs text-muted hover:text-red-400 shrink-0">
                Delete
              </button>
            </div>
            {item.note && <p className="text-sm text-muted">{item.note}</p>}
            {courseTitleFor(item.courseId) && (
              <span className="text-xs rounded-full border border-gold text-gold px-2 py-0.5 w-fit">
                {courseTitleFor(item.courseId)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
