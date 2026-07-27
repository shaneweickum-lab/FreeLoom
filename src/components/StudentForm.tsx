"use client";

import type { Student } from "@/lib/types";
import { GRADE_LEVEL_OPTIONS, type SchoolLevel } from "@/lib/gradeLevels";

const GRADE_LEVEL_GROUPS: SchoolLevel[] = ["Elementary", "Middle School", "High School"];

export type StudentFormValues = {
  name: string;
  gradeLevel: string;
  state: string;
  birthDate: string;
  gradYear: string;
  gender: string;
  graduationDate: string;
};

export const EMPTY_STUDENT_FORM: StudentFormValues = {
  name: "",
  gradeLevel: "",
  state: "",
  birthDate: "",
  gradYear: "",
  gender: "",
  graduationDate: "",
};

export function studentToFormValues(s: Student): StudentFormValues {
  return {
    name: s.name,
    gradeLevel: s.grade_level || "",
    state: s.state || "",
    birthDate: s.birth_date || "",
    gradYear: s.expected_graduation_year ? String(s.expected_graduation_year) : "",
    gender: s.gender || "",
    graduationDate: s.graduation_date || "",
  };
}

export function studentFormToPatch(form: StudentFormValues): Partial<Student> & { name: string } {
  return {
    name: form.name,
    grade_level: form.gradeLevel || null,
    state: form.state || null,
    birth_date: form.birthDate || null,
    expected_graduation_year: form.gradYear ? Number(form.gradYear) : null,
    gender: form.gender || null,
    graduation_date: form.graduationDate || null,
  };
}

/** The name/grade/state/birthdate/gender/grad-date form shared by every
 * place a student profile gets created or edited -- kept in one place so
 * the dashboard's edit flow and the Academic settings tab's create flow
 * can't drift apart. */
export default function StudentForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  isEditing,
  showCancel,
}: {
  form: StudentFormValues;
  onChange: (form: StudentFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
  submitting: boolean;
  isEditing: boolean;
  showCancel: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-4 max-w-lg">
      <h2 className="font-semibold">{isEditing ? "Edit student profile" : "New student profile"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className="input"
          placeholder="Student's name"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          required
        />
        <select className="input" value={form.gradeLevel} onChange={(e) => onChange({ ...form, gradeLevel: e.target.value })}>
          <option value="">Grade level</option>
          {GRADE_LEVEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {GRADE_LEVEL_OPTIONS.filter((option) => option.group === group).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {group}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          className="input"
          placeholder="State (e.g. CA, TX, NY)"
          value={form.state}
          onChange={(e) => onChange({ ...form, state: e.target.value })}
        />
        <input
          type="date"
          className="input"
          value={form.birthDate}
          onChange={(e) => onChange({ ...form, birthDate: e.target.value })}
        />
        <input
          type="number"
          className="input"
          placeholder="Expected grad year"
          value={form.gradYear}
          onChange={(e) => onChange({ ...form, gradYear: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select className="input" value={form.gender} onChange={(e) => onChange({ ...form, gender: e.target.value })}>
          <option value="">Gender (optional)</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Graduation date (once known — for the official transcript)
          <input
            type="date"
            className="input"
            value={form.graduationDate}
            onChange={(e) => onChange({ ...form, graduationDate: e.target.value })}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting || !form.name.trim()}>
          {isEditing ? "Save changes" : "Create profile"}
        </button>
        {showCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
