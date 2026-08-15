import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const SHARED_TRANSCRIPT = {
  student: {
    name: "Jamie Rivera",
    grade_level: "9",
    gender: null,
    birth_date: null,
    graduation_date: null,
    expected_graduation_year: null,
  },
  school: {
    school_name: "Rivera Family Homeschool",
    parent_name: "Alex Rivera",
    address: null,
    phone: null,
    email: null,
    logo_url: null,
    accent_color: null,
    layout_style: "formal" as const,
  },
  generated_at: "2026-01-01T00:00:00Z",
  courses: [{ course_title: "Algebra I", subject_area: "Mathematics", credit_hours: 1, letter_grade: "A", grade_level: "9" }],
  total_credit_hours: 1,
};

let rpcResults: Record<string, { data: unknown; error: unknown }>;
const uploadMock = vi.fn(async (): Promise<{ error: unknown }> => ({ error: null }));
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: "https://cdn.example.com/transcripts/x.pdf" } }));
const eqMock = vi.fn(async () => ({ error: null }));
const updateMock = vi.fn(() => ({ eq: eqMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: vi.fn(async (name: string) => rpcResults[name] ?? { data: null, error: null }),
    storage: { from: vi.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock })) },
    from: vi.fn(() => ({ update: updateMock })),
  })),
}));

const isRateLimitedMock = vi.fn(() => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: () => isRateLimitedMock(),
  getClientIp: () => "1.2.3.4",
}));

const renderToBufferMock = vi.fn(async () => Buffer.from("fake-pdf-bytes"));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: () => renderToBufferMock(),
}));

vi.mock("@/lib/TranscriptDocument", () => ({
  TranscriptDocument: () => null,
}));

import { GET } from "./route";

function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

function makeParams(transcriptId: string) {
  return { params: Promise.resolve({ transcriptId }) };
}

describe("GET /api/transcript-pdf/[transcriptId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    rpcResults = {
      get_shared_transcript: { data: SHARED_TRANSCRIPT, error: null },
      is_transcript_share_revoked: { data: false, error: null },
    };
    uploadMock.mockResolvedValue({ error: null });
  });

  it("429s once the rate limit is hit, without querying anything", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(429);
  });

  it("404s when the share RPC errors", async () => {
    rpcResults.get_shared_transcript = { data: null, error: { message: "boom" } };
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(404);
  });

  it("404s when the share RPC returns no data (unknown/unowned transcript)", async () => {
    rpcResults.get_shared_transcript = { data: null, error: null };
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(404);
  });

  it("404s when the share link has been revoked", async () => {
    rpcResults.is_transcript_share_revoked = { data: true, error: null };
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/revoked/i);
  });

  it("renders and streams the PDF with the right headers on success", async () => {
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("jamie_rivera_transcript.pdf");
    expect(renderToBufferMock).toHaveBeenCalled();
  });

  it("caches the rendered PDF's URL when the upload (RLS-gated) succeeds", async () => {
    await GET(makeRequest(), makeParams("t-1"));
    expect(uploadMock).toHaveBeenCalledWith("t-1.pdf", expect.anything(), { contentType: "application/pdf", upsert: true });
    expect(updateMock).toHaveBeenCalledWith({ pdf_url: "https://cdn.example.com/transcripts/x.pdf" });
    expect(eqMock).toHaveBeenCalledWith("id", "t-1");
  });

  it("still returns the PDF when caching is skipped (anonymous request, RLS blocks the upload)", async () => {
    uploadMock.mockResolvedValue({ error: { message: "not authorized" } });
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still returns the PDF even if the caching step throws outright", async () => {
    uploadMock.mockRejectedValue(new Error("storage unreachable"));
    const res = await GET(makeRequest(), makeParams("t-1"));
    expect(res.status).toBe(200);
  });
});
