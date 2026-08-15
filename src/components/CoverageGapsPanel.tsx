/** One subject area's worth of pipeline-miss history: how many times a
 * parent had to manually resolve an entry (Stage 1-4 all missed) that
 * ended up tagged with this subject -- see the admin_coverage_gaps() SQL
 * function this reads from. Not tied to any stored table row; this is a
 * live aggregate, not a persisted record. */
export type CoverageGapRow = {
  subject_area: string;
  resolution_count: number;
  most_recent_resolved_at: string;
  example_word_dump: string;
};

/**
 * Surfaces which subject areas keep needing a parent's manual resolution
 * instead of a confident classify() result -- the concrete, actionable
 * signal human_resolutions actually carries (see admin_coverage_gaps()'s
 * own SQL comment for why this is a coverage-gap report, not a general
 * edit-rate tracker: human_resolutions only logs that Stage 1-4 missed
 * entirely, not later edits to an already-confident entry). A subject
 * area showing up here repeatedly is a direct prompt to add its keywords
 * to knowledgeBase.ts or classify.ts's HEURISTIC_CLUSTERS.
 */
export default function CoverageGapsPanel({ rows, error }: { rows: CoverageGapRow[]; error?: string }) {
  if (error) {
    return <p className="text-sm text-muted">Couldn&apos;t load coverage gaps: {error}</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No manually-resolved entries yet -- this fills in once parents start hitting cases Stage 1-4 can&apos;t confidently
        classify.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm">
        Subject areas parents have had to resolve by hand most often -- each one is a concrete case for expanding
        knowledge-base or keyword-cluster coverage.
      </p>
      <div className="rounded-lg border border-navy-line overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-soft text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Subject area</th>
              <th className="text-left px-4 py-2 font-medium">Times resolved</th>
              <th className="text-left px-4 py-2 font-medium">Most recent</th>
              <th className="text-left px-4 py-2 font-medium">Example word dump</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.subject_area} className="border-t border-navy-line align-top">
                <td className="px-4 py-2 font-medium">{row.subject_area}</td>
                <td className="px-4 py-2 font-mono">{row.resolution_count}</td>
                <td className="px-4 py-2 text-muted">{new Date(row.most_recent_resolved_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-muted italic">&quot;{row.example_word_dump}&quot;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
