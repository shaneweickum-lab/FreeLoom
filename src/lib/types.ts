export type ActivityType = "game" | "book" | "project" | "platform" | "other";

export const ACTIVITY_TYPES: ActivityType[] = ["game", "book", "project", "platform", "other"];

export type CourseStatus = "suggested" | "approved" | "edited" | "rejected";

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

export type LearningLog = {
  id: string;
  student_id: string;
  raw_description: string;
  activity_type: ActivityType;
  source_platform: string | null;
  time_spent_minutes: number | null;
  date_logged: string;
  created_at: string;
};

export type TranslatedCourse = {
  id: string;
  learning_log_id: string;
  course_title: string;
  subject_area: string;
  credit_hours: number;
  ai_rationale: string;
  status: CourseStatus;
  letter_grade: string | null;
  grade_level: string | null;
  created_at: string;
};

export type PortfolioItem = {
  id: string;
  student_id: string;
  learning_log_id: string | null;
  file_url: string;
  caption: string | null;
  created_at: string;
};

export type Transcript = {
  id: string;
  student_id: string;
  generated_at: string;
  pdf_url: string | null;
  included_course_ids: string[];
};

export type TranslateLogRequest = {
  raw_description: string;
  activity_type: ActivityType;
  source_platform?: string | null;
  time_spent_minutes?: number | null;
  grade_level?: string | null;
};

export type TranslateLogResponse = {
  course_title: string;
  subject_area: string;
  credit_hours: number;
  rationale: string;
  source: "ai" | "heuristic";
};

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageKind = "user" | "assistant" | "tool_bridge";

export type ChatMessage = {
  id: string;
  student_id: string;
  conversation_id: string;
  role: ChatMessageRole;
  kind: ChatMessageKind;
  content: unknown[];
  created_at: string;
};

export type ChatConversation = {
  id: string;
  student_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanId = "free" | "plus" | "pro";

export type AccountPlan = {
  user_id: string;
  plan: PlanId;
  updated_at: string;
};
