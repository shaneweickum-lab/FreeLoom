"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import type { LearningLog, PortfolioItem } from "@/lib/types";

export default function PortfolioPage() {
  const { currentStudent } = useStudents();
  const [items, setItems] = useState<(PortfolioItem & { signedUrl?: string })[]>([]);
  const [logs, setLogs] = useState<LearningLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [caption, setCaption] = useState("");
  const [learningLogId, setLearningLogId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentStudent) {
      setItems([]);
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const [{ data: portfolioItems }, { data: learningLogs }] = await Promise.all([
      supabase.from("portfolio_items").select("*").eq("student_id", currentStudent.id).order("created_at", { ascending: false }),
      supabase.from("learning_logs").select("*").eq("student_id", currentStudent.id).order("created_at", { ascending: false }),
    ]);

    const withUrls = await Promise.all(
      (portfolioItems || []).map(async (item) => {
        const { data } = await supabase.storage.from("portfolio").createSignedUrl(item.file_url, 3600);
        return { ...item, signedUrl: data?.signedUrl };
      })
    );

    setItems(withUrls);
    setLogs(learningLogs || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!currentStudent || !file) return;
    setUploading(true);
    setError(null);
    const supabase = createClient();
    const path = `${currentStudent.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("portfolio").upload(path, file);
    if (uploadError) {
      console.error("Portfolio upload failed", uploadError);
      setError(`Upload failed: ${uploadError.message}`);
      setUploading(false);
      return;
    }
    const { error: insertError } = await supabase.from("portfolio_items").insert({
      student_id: currentStudent.id,
      learning_log_id: learningLogId || null,
      file_url: path,
      caption: caption || null,
    });
    if (insertError) {
      console.error("Portfolio item insert failed", insertError);
      setError(`Couldn't save that item: ${insertError.message}`);
      // Best-effort: don't leave an orphaned file in storage with no matching row.
      await supabase.storage.from("portfolio").remove([path]);
      setUploading(false);
      return;
    }
    setCaption("");
    setLearningLogId("");
    setFile(null);
    await load();
    setUploading(false);
  }

  async function deleteItem(item: PortfolioItem) {
    const supabase = createClient();
    setError(null);
    const { error: removeError } = await supabase.storage.from("portfolio").remove([item.file_url]);
    if (removeError) console.error("Portfolio file removal failed", removeError);
    const { error: deleteError } = await supabase.from("portfolio_items").delete().eq("id", item.id);
    if (deleteError) {
      console.error("Portfolio item delete failed", deleteError);
      setError(`Couldn't delete that item: ${deleteError.message}`);
    }
    await load();
  }

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }
  if (loading) return null;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Portfolio Builder</h1>
        <p className="text-muted text-sm">Attach work samples, photos, or writing to back up the transcript.</p>
      </div>

      <form onSubmit={addItem} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Caption (e.g. Factorio factory blueprint)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <select className="input" value={learningLogId} onChange={(e) => setLearningLogId(e.target.value)}>
            <option value="">Not linked to a log entry</option>
            {logs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.raw_description.slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-muted min-w-0"
          />
          <button type="submit" className="btn-primary ml-auto" disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Add to portfolio"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        {items.length === 0 && <p className="text-muted text-sm sm:col-span-2">No portfolio items yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-surface shadow-sm p-4 flex flex-col gap-2">
            {item.signedUrl && /\.(png|jpe?g|gif|webp)$/i.test(item.file_url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.signedUrl} alt={item.caption || "portfolio item"} className="rounded-md max-h-48 object-cover w-full" />
            )}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{item.caption || "Untitled"}</div>
                <div className="text-xs text-muted">{new Date(item.created_at).toLocaleDateString()}</div>
              </div>
              <button onClick={() => deleteItem(item)} className="text-xs text-muted hover:text-red-600 shrink-0">
                Delete
              </button>
            </div>
            {item.signedUrl && (
              <a href={item.signedUrl} target="_blank" rel="noreferrer" className="text-xs text-gold w-fit">
                Open file
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
