import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}));

import { GET } from "./route";

function makeRequest(authHeader: string | null): NextRequest {
  return {
    headers: { get: (name: string) => (name === "authorization" ? authHeader : null) },
  } as unknown as NextRequest;
}

describe("GET /api/cron/cleanup-threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  it("401s with no bearer token", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("runs the cleanup RPC with the correct bearer token", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("cleanup_stale_message_threads");
    const body = await res.json();
    expect(body).toEqual({ ok: true, deleted: 3 });
  });

  it("500s when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
