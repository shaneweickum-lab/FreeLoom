export type SuggestedTrack = {
  id: string;
  subjectArea: string;
  description: string;
  status: "suggested" | "accepted" | "dismissed";
};

export type StudentProfile = {
  name: string;
  gradeLevel: string;
  hobbies: string;
  personality: string;
  learningStyle: string;
  suggestedTracks: SuggestedTrack[];
};

export type CourseTranslation = {
  courseTitle: string;
  subjectArea: string;
  skills: string[];
  creditHours: number;
  rationale: string;
  source: "knowledge-base" | "ai-refined" | "heuristic";
};

export type LearningLogEntry = {
  id: string;
  date: string;
  description: string;
  hoursSpent?: number;
  translation: CourseTranslation | null;
  acceptedIntoTranscript: boolean;
  courseId: string | null;
};

export const LETTER_GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"] as const;
export type LetterGrade = (typeof LETTER_GRADES)[number];

export const GRADE_POINTS: Record<LetterGrade, number> = {
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  D: 1.0,
  F: 0.0,
};

export type Course = {
  id: string;
  title: string;
  subjectArea: string;
  creditHours: number;
  grade: LetterGrade;
  logEntryIds: string[];
};

export type PortfolioItem = {
  id: string;
  courseId: string | null;
  title: string;
  note: string;
  imageDataUrl: string | null;
  date: string;
};

export type FreeloomData = {
  student: StudentProfile;
  logEntries: LearningLogEntry[];
  courses: Course[];
  portfolioItems: PortfolioItem[];
};

export const EMPTY_DATA: FreeloomData = {
  student: {
    name: "",
    gradeLevel: "",
    hobbies: "",
    personality: "",
    learningStyle: "",
    suggestedTracks: [],
  },
  logEntries: [],
  courses: [],
  portfolioItems: [],
};
