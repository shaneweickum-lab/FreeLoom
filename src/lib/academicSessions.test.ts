import { describe, expect, it } from "vitest";
import { findCurrentSession, generateProposedSessions, type AcademicSession } from "./academicSessions";

function session(overrides: Partial<AcademicSession>): AcademicSession {
  return {
    id: "id",
    user_id: "user",
    label: "Session",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("findCurrentSession", () => {
  it("returns the session whose date range contains the given date", () => {
    const fall = session({ id: "fall", label: "Fall", start_date: "2026-08-15", end_date: "2026-12-20" });
    const spring = session({ id: "spring", label: "Spring", start_date: "2027-01-05", end_date: "2027-05-30" });
    expect(findCurrentSession([fall, spring], "2026-10-01")?.id).toBe("fall");
    expect(findCurrentSession([fall, spring], "2027-03-01")?.id).toBe("spring");
  });

  it("treats the start and end dates as inclusive", () => {
    const term = session({ start_date: "2026-08-15", end_date: "2026-12-20" });
    expect(findCurrentSession([term], "2026-08-15")).not.toBeNull();
    expect(findCurrentSession([term], "2026-12-20")).not.toBeNull();
  });

  it("returns null when the date falls between sessions", () => {
    const fall = session({ id: "fall", start_date: "2026-08-15", end_date: "2026-12-20" });
    const spring = session({ id: "spring", start_date: "2027-01-05", end_date: "2027-05-30" });
    expect(findCurrentSession([fall, spring], "2026-12-25")).toBeNull();
  });

  it("returns null when there are no sessions at all", () => {
    expect(findCurrentSession([], "2026-10-01")).toBeNull();
  });

  it("defaults to today when no date is given", () => {
    const today = new Date().toISOString().slice(0, 10);
    const term = session({ start_date: today, end_date: today });
    expect(findCurrentSession([term])).not.toBeNull();
  });

  it("returns the first match in order when sessions overlap", () => {
    const first = session({ id: "first", start_date: "2026-01-01", end_date: "2026-06-30" });
    const second = session({ id: "second", start_date: "2026-03-01", end_date: "2026-09-30" });
    expect(findCurrentSession([first, second], "2026-04-01")?.id).toBe("first");
  });
});

describe("generateProposedSessions", () => {
  it("produces one full-year session spanning the whole range", () => {
    const sessions = generateProposedSessions("full_year", "2026-08-01", "2027-05-31");
    expect(sessions).toEqual([{ label: "Full Year 2026", start_date: "2026-08-01", end_date: "2027-05-31" }]);
  });

  it("splits a semester structure into two contiguous, non-overlapping ranges", () => {
    const sessions = generateProposedSessions("semester", "2026-08-01", "2027-05-31");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].start_date).toBe("2026-08-01");
    expect(sessions[1].end_date).toBe("2027-05-31");
    // Contiguous: the second session starts the day after the first ends.
    const firstEnd = new Date(sessions[0].end_date + "T00:00:00Z");
    const secondStart = new Date(sessions[1].start_date + "T00:00:00Z");
    expect(secondStart.getTime() - firstEnd.getTime()).toBe(86_400_000);
  });

  it("splits a quarter structure into four ranges covering the full span with no gaps or overlaps", () => {
    const sessions = generateProposedSessions("quarter", "2026-01-01", "2026-12-31");
    expect(sessions).toHaveLength(4);
    expect(sessions[0].start_date).toBe("2026-01-01");
    expect(sessions[3].end_date).toBe("2026-12-31");
    for (let i = 1; i < sessions.length; i++) {
      const prevEnd = new Date(sessions[i - 1].end_date + "T00:00:00Z");
      const start = new Date(sessions[i].start_date + "T00:00:00Z");
      expect(start.getTime() - prevEnd.getTime()).toBe(86_400_000);
    }
  });

  it("splits a trimester structure into three ranges", () => {
    const sessions = generateProposedSessions("trimester", "2026-09-01", "2027-06-01");
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.label)).toEqual(["Trimester 1 2026", "Trimester 2 2026", "Trimester 3 2027"]);
  });

  it("labels each session with its own start year, not necessarily the range's start year", () => {
    const sessions = generateProposedSessions("semester", "2026-08-15", "2027-05-30");
    expect(sessions[0].label).toBe("Fall Semester 2026");
    expect(sessions[1].label).toBe("Spring Semester 2027");
  });

  it("returns an empty array when the end date precedes the start date", () => {
    expect(generateProposedSessions("semester", "2027-01-01", "2026-01-01")).toEqual([]);
  });
});
