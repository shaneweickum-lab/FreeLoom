import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Same chainable + awaitable fake query result helper as
 * src/app/api/messages/route.test.ts, extended with order/single for this
 * route's history-select and message-insert chains. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update", "order", "gte"]) {
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
  callBennyChat: vi.fn(async () => ({ reply: "a benny reply", tokens: 123 })),
}));

import { POST } from "./route";
import { callBennyChat } from "@/lib/benny/chat";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1", email: "parent@example.com" };
const CONVERSATION_ID = "conversation-1";
const OWN_CONVERSATION = { id: CONVERSATION_ID, user_id: USER.id, title: "New conversation" };

// Premium + active, no admin row -- isBennyAvailable() is true and
// getBennyUsageWindow() has no cap, so this profile alone never queues an
// extra benny_token_usage lookup, keeping the queue order below stable for
// every test that isn't specifically about the trial/cap gate.
const AVAILABLE_PROFILE = {
  data: {
    subscription_tier: "premium",
    subscription_status: "active",
    grandfathered_until: null,
    current_period_end: null,
    benny_trial_ends_at: null,
  },
  error: null,
};
const NO_ADMIN_ROW = { data: null, error: null };

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

  it("403s when Benny isn't available on the account's plan", async () => {
    // Free tier, no trial (benny_trial_ends_at null) -- isBennyAvailable() false.
    fromQueue = [
      { data: { subscription_tier: "free", subscription_status: null, grandfathered_until: null, current_period_end: null, benny_trial_ends_at: null }, error: null },
      NO_ADMIN_ROW,
    ];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(403);
    expect(callBennyChat).not.toHaveBeenCalled();
  });

  it("429s once the account's Benny token cap is used up", async () => {
    // Pro tier -- cap is 200,000/month; usage query returns rows summing to it exactly.
    fromQueue = [
      { data: { subscription_tier: "pro", subscription_status: "active", grandfathered_until: null, current_period_end: null, benny_trial_ends_at: null }, error: null },
      NO_ADMIN_ROW,
      { data: [{ tokens: 150_000 }, { tokens: 50_000 }], error: null }, // usage sum
    ];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(429);
    expect(callBennyChat).not.toHaveBeenCalled();
  });

  it("404s when the conversation doesn't exist", async () => {
    fromQueue = [AVAILABLE_PROFILE, NO_ADMIN_ROW, { data: null, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(404);
  });

  it("403s when the conversation belongs to someone else", async () => {
    fromQueue = [AVAILABLE_PROFILE, NO_ADMIN_ROW, { data: { ...OWN_CONVERSATION, user_id: "someone-else" }, error: null }];
    const res = await POST(makeRequest({ conversationId: CONVERSATION_ID, body: "hi" }));
    expect(res.status).toBe(403);
  });

  it("inserts both messages, calls Benny, logs usage, and returns them", async () => {
    fromQueue = [
      AVAILABLE_PROFILE,
      NO_ADMIN_ROW,
      { data: OWN_CONVERSATION, error: null }, // ownership check
      { data: [], error: null }, // history
      { data: { id: "m-user", role: "user", body: "hi" }, error: null }, // user message insert
      { data: { id: "m-assistant", role: "assistant", body: "a benny reply" }, error: null }, // assistant message insert
      { error: null }, // usage insert
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
