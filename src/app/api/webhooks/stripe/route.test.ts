import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "upsert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let fromQueue: unknown[];
let fromCalls: { table: string; method: string; args: unknown[] }[];

function makeAdminClient() {
  return {
    from: vi.fn((table: string) => {
      const c = chain(fromQueue.shift() ?? { data: null, error: null });
      for (const method of ["insert", "upsert"]) {
        const original = c[method] as (...a: unknown[]) => unknown;
        c[method] = (...args: unknown[]) => {
          fromCalls.push({ table, method, args });
          return original(...args);
        };
      }
      return c;
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => makeAdminClient()),
}));

let constructEventImpl: (...args: unknown[]) => unknown;
const retrieveSubscription = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    webhooks: { constructEvent: (...args: unknown[]) => constructEventImpl(...args) },
    subscriptions: { retrieve: (...args: unknown[]) => retrieveSubscription(...args) },
  })),
  tierAndIntervalForPrice: vi.fn((priceId: string) =>
    priceId === "price_pro_month" ? { tier: "pro", interval: "month" } : null
  ),
}));

import { POST } from "./route";

function makeRequest(body: string, hasSignature = true): NextRequest {
  return {
    text: async () => body,
    headers: { get: (name: string) => (name === "stripe-signature" && hasSignature ? "sig_test" : null) },
  } as unknown as NextRequest;
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromQueue = [];
    fromCalls = [];
    constructEventImpl = vi.fn(() => ({ type: "unhandled.event", data: { object: {} } }));
  });

  it("400s when the stripe-signature header is missing", async () => {
    const res = await POST(makeRequest("{}", false));
    expect(res.status).toBe(400);
  });

  it("400s when signature verification fails", async () => {
    constructEventImpl = vi.fn(() => {
      throw new Error("bad signature");
    });
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(400);
  });

  it("syncs subscription_tier on checkout.session.completed", async () => {
    constructEventImpl = vi.fn(() => ({
      type: "checkout.session.completed",
      data: { object: { metadata: { supabase_user_id: "user-1" }, subscription: "sub_123" } },
    }));
    retrieveSubscription.mockResolvedValue({
      id: "sub_123",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_pro_month" }, current_period_end: 1700000000 }] },
    });
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const upsertCall = fromCalls.find((c) => c.table === "school_profiles" && c.method === "upsert");
    expect(upsertCall?.args[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", subscription_tier: "pro", subscription_status: "active" })
    );
  });

  it("records cancel_at_period_end when a Portal cancellation comes through as an update", async () => {
    constructEventImpl = vi.fn(() => ({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          status: "active",
          customer: "cus_1",
          metadata: { supabase_user_id: "user-1" },
          cancel_at_period_end: true,
          items: { data: [{ price: { id: "price_pro_month" }, current_period_end: 1700000000 }] },
        },
      },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const upsertCall = fromCalls.find((c) => c.table === "school_profiles" && c.method === "upsert");
    expect(upsertCall?.args[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", subscription_status: "active", cancel_at_period_end: true })
    );
  });

  it("also records cancel_at_period_end when Stripe schedules it via cancel_at instead", async () => {
    // Observed in practice: the Customer Portal's default cancel flow sets
    // cancel_at (a timestamp) rather than flipping cancel_at_period_end,
    // on at least this Stripe API version -- either one means "ending."
    constructEventImpl = vi.fn(() => ({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          status: "active",
          customer: "cus_1",
          metadata: { supabase_user_id: "user-1" },
          cancel_at_period_end: false,
          cancel_at: 1700000000,
          items: { data: [{ price: { id: "price_pro_month" }, current_period_end: 1700000000 }] },
        },
      },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const upsertCall = fromCalls.find((c) => c.table === "school_profiles" && c.method === "upsert");
    expect(upsertCall?.args[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", cancel_at_period_end: true })
    );
  });

  it("resets to free on customer.subscription.deleted", async () => {
    constructEventImpl = vi.fn(() => ({
      type: "customer.subscription.deleted",
      data: { object: { metadata: { supabase_user_id: "user-1" }, customer: "cus_1" } },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const upsertCall = fromCalls.find((c) => c.table === "school_profiles" && c.method === "upsert");
    expect(upsertCall?.args[0]).toEqual(
      expect.objectContaining({
        user_id: "user-1",
        subscription_tier: "free",
        subscription_status: "canceled",
        cancel_at_period_end: false,
      })
    );
  });

  it("inserts an in-app notification on invoice.payment_failed", async () => {
    fromQueue = [{ data: { user_id: "user-1" }, error: null }, { data: null, error: null }];
    constructEventImpl = vi.fn(() => ({
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", customer: "cus_1" } },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const insertCall = fromCalls.find((c) => c.table === "notifications" && c.method === "insert");
    expect(insertCall?.args[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", type: "announcement", related_id: "in_1" })
    );
  });

  it("skips inserting a second notification when this invoice was already redelivered", async () => {
    // Stripe documents webhook delivery as at-least-once, not exactly-once.
    fromQueue = [{ data: { user_id: "user-1" }, error: null }, { data: { id: "existing-notif" }, error: null }];
    constructEventImpl = vi.fn(() => ({
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", customer: "cus_1" } },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const insertCall = fromCalls.find((c) => c.table === "notifications" && c.method === "insert");
    expect(insertCall).toBeUndefined();
  });

  it("500s instead of silently discarding a failed school_profiles sync", async () => {
    fromQueue = [{ data: null, error: { message: "connection reset" } }];
    constructEventImpl = vi.fn(() => ({
      type: "customer.subscription.deleted",
      data: { object: { metadata: { supabase_user_id: "user-1" }, customer: "cus_1" } },
    }));
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(500);
  });
});
