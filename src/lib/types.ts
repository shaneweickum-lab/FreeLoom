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

export type SchoolingType = "homeschooling" | "unschooling" | "wildschooling";

export type SchoolProfile = {
  user_id: string;
  school_name: string | null;
  parent_name: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  accent_color: string | null;
  layout_style: LayoutStyle;
  schooling_type: SchoolingType | null;
  /** When true, admin_view_account() replaces every student's real name
   * with a placeholder ("Student 1", "Student 2", ...) before it ever
   * leaves the database -- everything else stays visible. */
  hide_student_names: boolean;
  /** When true, AdminAccountView masks every student's birth_date with a
   * fixed placeholder instead of the real date, in the same admin
   * read-only context hide_student_names already covers. */
  hide_student_birthdates: boolean;
  /** Saved to the account (not just the browser) so it follows the user
   * across devices -- read server-side by (app)/layout.tsx and applied via
   * a [data-theme] CSS override, see globals.css. */
  theme_preference: "light" | "dark";
  email_notify_messages: boolean;
  email_notify_announcements: boolean;
  /** Mutes a notification type from ever being inserted for this account --
   * distinct from the email toggles above, which only control whether an
   * email also goes out. */
  mute_in_app_messages: boolean;
  mute_in_app_announcements: boolean;
  /** Days of inactivity after which one of this account's support_threads
   * (and its messages) gets deleted by the daily cleanup-threads cron. Null
   * means never auto-delete -- the column default, so no existing account
   * is affected until a parent opts in. Constrained 7-30 by a DB check. */
  thread_retention_days: number | null;
  /** Per-user opt-in for the Benny assistant-mode chat panel. Independent
   * of whether a real chat backend exists yet (src/lib/benny/chat.ts) --
   * this just controls whether the trigger button/panel show up at all. */
  benny_assistant_enabled: boolean;
  /** The tier this account is actually subscribed to (or 'free' if never
   * subscribed / after cancellation) -- only trusted when
   * subscription_status is 'active'/'trialing'. Use
   * src/lib/billing/tier.ts's getEffectiveTier() rather than reading this
   * column directly, since it also accounts for grandfathered_until. */
  subscription_tier: "free" | "pro" | "premium";
  subscription_status:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "incomplete"
    | "incomplete_expired"
    | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: "month" | "quarter" | "year" | null;
  current_period_end: string | null;
  /** One-time migration backfill: existing accounts get temporary Premium
   * access through this timestamp regardless of subscription_tier, so
   * nobody's real usage breaks the moment tiers went live. Null for any
   * account created after that migration ran. */
  grandfathered_until: string | null;
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

/** A landing-page waitlist signup -- public, anonymous, insert-only from the
 * visitor's side; only readable by an approved admin (see /admin). */
export type WaitlistSignup = {
  id: string;
  email: string;
  created_at: string;
};

/** One row in the admin roster. Any account in this table can read the
 * waitlist and approve/remove other admins -- see is_admin() in the
 * database, which every admin-gated RLS policy checks against. */
export type AdminUser = {
  user_id: string;
  email: string;
  approved_by: string | null;
  created_at: string;
};

/** One named conversation with the admin team -- a parent can have several
 * (e.g. "Billing", "Transcript question"), each with its own messages. */
export type SupportThread = {
  id: string;
  parent_user_id: string;
  subject: string;
  created_by: string;
  created_at: string;
  last_message_at: string;
};

/** One message within a support thread. */
export type SupportMessage = {
  id: string;
  thread_id: string;
  parent_user_id: string;
  sender_user_id: string;
  sender_role: "parent" | "admin";
  body: string;
  read_at: string | null;
  created_at: string;
};

/** One Benny assistant-mode conversation -- always single-viewer (just the
 * owning user), unlike SupportThread which two different people view. */
export type BennyConversation = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/** One message within a Benny conversation. */
export type BennyMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  body: string;
  created_at: string;
};

export type AnnouncementTargetType = "everyone" | "user" | "schooling_type";

export type AnnouncementPost = {
  id: string;
  title: string;
  body: string;
  created_by: string | null;
  target_type: AnnouncementTargetType;
  target_user_id: string | null;
  target_schooling_type: SchoolingType | null;
  created_at: string;
};

export type AccessRequestStatus = "pending" | "approved" | "denied" | "expired" | "revoked";

/** A single admin's consent-gated, time-boxed request to view one parent's
 * account read-only -- see admin_view_account() in the database, which only
 * succeeds while status='approved' and expires_at is in the future. */
export type AccountAccessRequest = {
  id: string;
  target_user_id: string;
  requested_by: string;
  status: AccessRequestStatus;
  reason: string | null;
  requested_at: string;
  responded_at: string | null;
  expires_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
};

export type NotificationType = "message" | "announcement" | "access_request";

export type AppNotification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link_path: string | null;
  related_id: string | null;
  read_at: string | null;
  created_at: string;
};
