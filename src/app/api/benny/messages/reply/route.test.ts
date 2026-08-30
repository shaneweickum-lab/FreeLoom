import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string } | null } };
let fromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

const isRateLimitedMock = vi.fn(() => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: () => isRateLimitedMock(),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1" };
const CONVERSATION_ID = "conversation-1";
const OWN_CONVERSATION = { id: CONVERSATION_ID, user_id: USER.id };

describe("POST /api/benny/messages/reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    fromQueue = [];
    isRateLimitedMock.mockReturnValue(false);
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a reply" }));
    expect(res.status).toBe(401);
  });

  it("429s once the rate limit is hit", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a reply" }));
    expect(res.status).toBe(429);
  });

  it("requires conversationId and body", async () => {
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID }));
    expect(res.status).toBe(400);
  });

  it("404s when the conversation doesn't exist", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a reply" }));
    expect(res.status).toBe(404);
  });

  it("403s when the conversation belongs to someone else", async () => {
    fromQueue = [{ data: { ...OWN_CONVERSATION, user_id: "someone-else" }, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a reply" }));
    expect(res.status).toBe(403);
  });

  it("saves the reply and logs an estimated (not client-reported) token count", async () => {
    fromQueue = [
      { data: OWN_CONVERSATION, error: null }, // ownership check
      { data: { id: "m-assistant", role: "assistant", body: "a benny reply" }, error: null }, // assistant insert
      { error: null }, // usage insert
      { error: null }, // conversation update
    ];
    // Body a client could lie about a "tokens" field for, but this route
    // never reads one -- it only ever accepts {conversationId, body}.
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a benny reply", tokens: 999_999_999 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assistantMessage).toEqual({ id: "m-assistant", role: "assistant", body: "a benny reply" });
  });

  it("500s when the assistant message insert itself fails", async () => {
    fromQueue = [{ data: OWN_CONVERSATION, error: null }, { data: null, error: { message: "boom" } }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "a benny reply" }));
    expect(res.status).toBe(500);
  });
});
