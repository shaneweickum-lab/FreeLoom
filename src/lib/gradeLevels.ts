/**
 * The K-12 grade levels a student profile's grade_level field is drawn
 * from -- replaces a free-text input (previously anything the parent
 * typed, e.g. "9th grade" vs "9" vs "Freshman", was stored verbatim with no
 * normalization). Each option carries its school-level group (Elementary/
 * Middle School/High School) purely for display -- grade_level itself still
 * just stores the bare value (e.g. "K", "6", "9").
 */

export type SchoolLevel = "Elementary" | "Middle School" | "High School";

export type GradeLevelOption = {
  value: string;
  label: string;
  group: SchoolLevel;
};

export const GRADE_LEVEL_OPTIONS: GradeLevelOption[] = [
  { value: "K", label: "K", group: "Elementary" },
  { value: "1", label: "1st grade", group: "Elementary" },
  { value: "2", label: "2nd grade", group: "Elementary" },
  { value: "3", label: "3rd grade", group: "Elementary" },
  { value: "4", label: "4th grade", group: "Elementary" },
  { value: "5", label: "5th grade", group: "Elementary" },
  { value: "6", label: "6th grade", group: "Middle School" },
  { value: "7", label: "7th grade", group: "Middle School" },
  { value: "8", label: "8th grade", group: "Middle School" },
  { value: "9", label: "9th grade", group: "High School" },
  { value: "10", label: "10th grade", group: "High School" },
  { value: "11", label: "11th grade", group: "High School" },
  { value: "12", label: "12th grade", group: "High School" },
];
