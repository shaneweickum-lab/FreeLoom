import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Same chainable + awaitable fake query result helper as
 * src/app/api/messages/route.test.ts, extended with order/single for this
 * route's history-select and message-insert chains. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string; email: string } | null } };
let fromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

vi.mock("@/lib/benny/chat", () => ({
  callBennyChat: vi.fn(async () => "a benny reply"),
}));

import { POST } from "./route";
import { callBennyChat } from "@/lib/benny/chat";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1", email: "parent@example.com" };
const CONVERSATION_ID = "conversation-1";
const OWN_CONVERSATION = { id: CONVERSATION_ID, user_id: USER.id, title: "New conversation" };

describe("POST /api/benny/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(401);
  });

  it("requires conversationId and body", async () => {
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID }));
    expect(res.status).toBe(400);
  });

  it("404s when the conversation doesn't exist", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(404);
  });

  it("403s when the conversation belongs to someone else", async () => {
    fromQueue = [{ data: { ...OWN_CONVERSATION, user_id: "someone-else" }, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(403);
  });

  it("inserts both messages, calls Benny, and returns them", async () => {
    fromQueue = [
      { data: OWN_CONVERSATION, error: null }, // ownership check
      { data: [], error: null }, // history
      { data: { id: "m-user", role: "user", body: "hi" }, error: null }, // user message insert
      { data: { id: "m-assistant", role: "assistant", body: "a benny reply" }, error: null }, // assistant message insert
      { error: null }, // conversation update
    ];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userMessage).toEqual({ id: "m-user", role: "user", body: "hi" });
    expect(data.assistantMessage).toEqual({ id: "m-assistant", role: "assistant", body: "a benny reply" });
    expect(callBennyChat).toHaveBeenCalledWith({ history: [], message: "hi" });
  });
});
