export type ActivityType = "game" | "book" | "project" | "platform" | "other";

export const ACTIVITY_TYPES: ActivityType[] = ["game", "book", "project", "platform", "other"];

export type Student = {
  id: string;
  user_id: string;
  name: string;
  birth_date: string | null;
  grade_level: string | null;
  state: string | null;
  expected_graduation_year: number | null;
  gender: string | null;
  graduation_date: string | null;
  created_at: string;
};

export type LayoutStyle = "formal" | "casual";

export type SchoolProfile = {
  user_id: string;
  school_name: string | null;
  parent_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  accent_color: string | null;
  layout_style: LayoutStyle;
  updated_at: string;
};

export type SuggestedTrack = {
  subject: string;
  rationale: string;
  status: "suggested" | "accepted" | "dismissed";
};

export type ProfileNote = {
  id: string;
  student_id: string;
  content: string;
  ai_suggested_tracks: SuggestedTrack[];
  created_at: string;
  updated_at: string;
};

export type Transcript = {
  id: string;
  student_id: string;
  generated_at: string;
  pdf_url: string | null;
  included_entry_ids: string[];
  branding_snapshot: Record<string, unknown> | null;
};

export type EntryStatus = "draft" | "accepted" | "needs_human_review";
export type SourceStage = "retrieval" | "template" | "human" | "legacy_ai";

/** One subject grouping in a child's portfolio — the new schema's "class." */
export type PipelineClass = {
  id: string;
  student_id: string;
  subject_area: string;
  title: string;
  /** Parent-settable, optional -- the left rail's credit ledger only shows
   * a progress bar against this when it's set; otherwise it just shows
   * accumulated credits with no fabricated target. */
  target_credits: number | null;
  created_at: string;
};

/** A translated word dump: what the pipeline drafted, what the parent kept.
 * The singular subject_tags/credit_value/final_description/final_reasoning
 * columns here mirror the *first* row in that entry's entry_subject_tags
 * (see below) for backward compatibility with pages that haven't been
 * updated to read the full multi-tag breakdown yet (portfolio, transcript). */
export type PipelineEntry = {
  id: string;
  class_id: string;
  student_id: string;
  raw_word_dump: string;
  extracted_slots: { activity_type: string | null; source_platform: string | null; time_spent_minutes: number | null };
  subject_tags: string[];
  skill_tags: string[];
  credit_value: number;
  generated_description: string | null;
  generated_reasoning: string | null;
  final_description: string | null;
  final_reasoning: string | null;
  letter_grade: string | null;
  grade_level: string | null;
  status: EntryStatus;
  source_stage: SourceStage;
  created_at: string;
  updated_at: string;
};

export type TagConfidence = "high" | "medium" | "low" | "human";

/** Which pipeline stage (or a parent, directly) produced a tag. Distinct
 * from SourceStage above, which is a coarser whole-entry vocabulary -- this
 * is the finer-grained provenance the reasoning panel actually shows per
 * tag (see DraftSource in pipeline/classify.ts, which this mirrors plus
 * "human" for a parent-authored tag). */
export type TagSource = "knowledge_base" | "heuristic_cluster" | "retrieval" | "fragment_composition" | "human";

/** One subject tag for an entry -- the "why this mapping" reasoning panel's
 * unit of display/edit. An entry can have more than one when the word dump
 * genuinely named more than one distinct subject. */
export type PipelineEntrySubjectTag = {
  id: string;
  entry_id: string;
  student_id: string;
  subject_area: string;
  course_title: string;
  credit_value: number;
  confidence: TagConfidence;
  /** The exact phrase in the entry's raw_word_dump that produced this tag,
   * or null (a retrieval-matched tag, a Stage 3 generic fallback, or a
   * historical row backfilled before this column existed). */
  quoted_phrase: string | null;
  reasoning: string;
  source_stage: TagSource;
  created_at: string;
};
