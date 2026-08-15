import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

type QueryResult = { data: unknown; error: unknown };

/** A minimal thenable that mimics a Supabase query builder chain closely
 * enough for this route: every filter method returns the same object (so
 * any chain length/order works), and awaiting it resolves to the queued
 * result -- same shape this route's own destructuring expects. */
function makeChain(result: QueryResult) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    order: () => chain,
    insert: () => chain,
    then: (resolve: (value: QueryResult) => void) => resolve(result),
  };
  return chain;
}

const queues: Record<string, QueryResult[]> = {};
const insertMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  const queue = queues[table] ?? [];
  const next = queue.shift() ?? { data: null, error: null };
  const chain = makeChain(next);
  return { ...chain, insert: (rows: unknown) => (insertMock(table, rows), makeChain(next)) };
});
const createAdminClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClientMock(),
}));

import { GET } from "./route";

function makeRequest(authHeader: string | null): NextRequest {
  return {
    headers: { get: (name: string) => (name === "authorization" ? authHeader : null) },
  } as unknown as NextRequest;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const STUDENT = { id: "student-1", user_id: "user-1", name: "Riley" };

/** Sets up the three flat queries (school_profiles/entries/notifications)
 * this route runs after loading students -- only students queueing needs
 * to happen separately since it's queried before these three. */
function queueEligibility(overrides?: {
  profiles?: QueryResult;
  entries?: QueryResult;
  recentNudges?: QueryResult;
}) {
  queues.school_profiles = [overrides?.profiles ?? { data: [{ user_id: "user-1", mute_in_app_streak_nudges: false }], error: null }];
  queues.entries = [
    overrides?.entries ?? {
      data: [
        { student_id: "student-1", created_at: daysAgoIso(6) },
        { student_id: "student-1", created_at: daysAgoIso(10) },
        { student_id: "student-1", created_at: daysAgoIso(15) },
      ],
      error: null,
    },
  ];
  queues.notifications = [overrides?.recentNudges ?? { data: [], error: null }, { data: null, error: null }];
}

describe("GET /api/cron/streak-nudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.RESEND_API_KEY;
    for (const key of Object.keys(queues)) delete queues[key];
  });

  it("401s with no bearer token", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("nudges nobody when there are no students at all", async () => {
    queues.students = [{ data: [], error: null }];
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("nudges a student whose streak is 5-8 days stale with enough recent history", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility();
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 1 });
    expect(insertMock).toHaveBeenCalledWith(
      "notifications",
      expect.arrayContaining([expect.objectContaining({ user_id: "user-1", type: "streak_nudge", related_id: "student-1" })])
    );
  });

  it("skips a student whose account has muted streak nudges", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility({ profiles: { data: [{ user_id: "user-1", mute_in_app_streak_nudges: true }], error: null } });
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips a student with fewer than 3 entries in the last 30 days", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility({ entries: { data: [{ student_id: "student-1", created_at: daysAgoIso(6) }], error: null } });
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
  });

  it("skips a student whose last entry is too recent (still an active streak)", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility({
      entries: {
        data: [
          { student_id: "student-1", created_at: daysAgoIso(1) },
          { student_id: "student-1", created_at: daysAgoIso(8) },
          { student_id: "student-1", created_at: daysAgoIso(15) },
        ],
        error: null,
      },
    });
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
  });

  it("skips a student whose streak already lapsed more than 8 days ago", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility({
      entries: {
        data: [
          { student_id: "student-1", created_at: daysAgoIso(20) },
          { student_id: "student-1", created_at: daysAgoIso(25) },
          { student_id: "student-1", created_at: daysAgoIso(28) },
        ],
        error: null,
      },
    });
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
  });

  it("skips a student already nudged within the cooldown window", async () => {
    queues.students = [{ data: [STUDENT], error: null }];
    queueEligibility({ recentNudges: { data: [{ related_id: "student-1" }], error: null } });
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, nudged: 0 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("500s when loading students fails", async () => {
    queues.students = [{ data: null, error: { message: "boom" } }];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
