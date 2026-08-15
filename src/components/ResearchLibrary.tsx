"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ResearchCitation } from "@/lib/types";
import Card from "@/components/ui/Card";

const PAGE_SIZE = 20;

/** The exact 5 categories freeloom_scraper.py's QUERIES list groups every
 * citation under -- a fixed, known set (like GRADE_LEVEL_OPTIONS or
 * SchoolingType elsewhere in this app), not something worth a live DISTINCT
 * query against a 5,000+ row table just to populate a filter's options. */
const CATEGORIES = [
  "Core Pedagogy",
  "Wildschooling & Nature-Based",
  "Neurodivergent & Support",
  "Digital & Game-Based",
  "Electives & Interest-Based",
];

const EVIDENCE_LEVEL_BADGE: Record<string, string> = {
  "Peer-Reviewed Journal Article": "bg-gold/15 text-gold",
  "ERIC Educational Record": "bg-violet/15 text-violet-soft",
};

function CitationCard({ citation }: { citation: ResearchCitation }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase tracking-wide text-muted">{citation.category}</span>
          <h3 className="font-serif font-semibold leading-snug">{citation.title}</h3>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            EVIDENCE_LEVEL_BADGE[citation.evidence_level] ?? "bg-navy-line/60 text-muted"
          }`}
        >
          {citation.evidence_level}
        </span>
      </div>
      <p className="text-sm text-muted">{citation.summary}</p>
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted">
        <span>
          {citation.primary_subject}
          {citation.secondary_subject ? ` · ${citation.secondary_subject}` : ""} — {citation.source}
        </span>
        {citation.source_url && (
          <a href={citation.source_url} target="_blank" rel="noreferrer" className="text-gold hover:underline shrink-0">
            View source
          </a>
        )}
      </div>
    </Card>
  );
}

/** A searchable, filterable browse of real academic citations backing up
 * alternative-schooling approaches (see freeloom_scraper.py for how these
 * were sourced) -- for a parent's own confidence, or to point to if their
 * approach is ever questioned. Deliberately NOT the same thing as
 * knowledge_base: this is reference material about a pedagogy, not
 * activity keywords the classify pipeline matches against, so it's fetched
 * and paginated independently rather than reusing that table/pipeline. */
export default function ResearchLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [citations, setCitations] = useState<ResearchCitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  async function loadPage(offset: number, replace: boolean) {
    const supabase = createClient();
    let q = supabase
      .from("research_citations")
      .select("*")
      .order("title", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (category) q = q.eq("category", category);
    const trimmed = query.trim();
    if (trimmed) q = q.or(`title.ilike.%${trimmed}%,summary.ilike.%${trimmed}%`);

    const { data, error: fetchError } = await q;
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    const rows = (data as ResearchCitation[]) ?? [];
    setCitations((prev) => (replace ? rows : [...prev, ...rows]));
    setHasMore(rows.length === PAGE_SIZE);
  }

  useEffect(() => {
    // Synchronous, not just the debounced fetch below -- the loading
    // state should flip the instant the search/category input changes,
    // not 300ms later once the debounced fetch actually starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    // Debounced -- every keystroke re-querying a 5,000+ row table (even
    // filtered) is wasted round-trips for a query the user hasn't finished typing.
    const timeout = setTimeout(async () => {
      await loadPage(0, true);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category]);

  async function loadMore() {
    setLoadingMore(true);
    await loadPage(citations.length, false);
    setLoadingMore(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <input
          className="input sm:w-96"
          placeholder="Search by topic or keyword…"
          aria-label="Search research citations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${
              category === null ? "border-gold bg-gold/15 text-gold" : "border-navy-line text-muted hover:text-foreground"
            }`}
          >
            All categories
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium border ${
                category === c ? "border-gold bg-gold/15 text-gold" : "border-navy-line text-muted hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : citations.length === 0 ? (
        <p className="text-muted text-sm">No citations match that search.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {citations.map((c) => (
            <CitationCard key={c.id} citation={c} />
          ))}
        </div>
      )}

      {!loading && hasMore && citations.length > 0 && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary w-fit">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
