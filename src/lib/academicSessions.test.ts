import { describe, expect, it } from "vitest";
import { findCurrentSession, type AcademicSession } from "./academicSessions";

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
