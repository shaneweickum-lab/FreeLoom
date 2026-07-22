import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import Stripe from "stripe";

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

let getUserResult: { data: { user: { id: string; email: string } | null } };
let fromQueue: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: vi.fn(() => chain(fromQueue.shift() ?? { data: null, error: null })),
  })),
}));

const createCustomer = vi.fn(async () => ({ id: "cus_new" }));
const retrieveCustomer = vi.fn(async () => ({ deleted: false }));
const createSession = vi.fn(async () => ({ url: "https://checkout.stripe.com/session123" }));
const listSubscriptions = vi.fn(async (): Promise<{ data: { id: string; status: string }[] }> => ({ data: [] }));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    customers: {
      create: (...args: Parameters<typeof createCustomer>) => createCustomer(...args),
      retrieve: (...args: Parameters<typeof retrieveCustomer>) => retrieveCustomer(...args),
    },
    checkout: { sessions: { create: (...args: Parameters<typeof createSession>) => createSession(...args) } },
    subscriptions: { list: (...args: Parameters<typeof listSubscriptions>) => listSubscriptions(...args) },
  })),
  priceIdFor: vi.fn((tier: string, interval: string) =>
    tier === "pro" && interval === "month" ? "price_pro_month" : undefined
  ),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1", email: "parent@example.com" };

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid tier/interval", async () => {
    const res = await POST(makeRequest({ tier: "gold", interval: "month" }));
    expect(res.status).toBe(400);
  });

  it("500s when the plan has no configured Price ID", async () => {
    const res = await POST(makeRequest({ tier: "premium", interval: "year" }));
    expect(res.status).toBe(500);
  });

  it("creates a new Stripe customer when none exists yet, then a checkout session", async () => {
    fromQueue = [{ data: null, error: null }, { error: null }];
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://checkout.stripe.com/session123");
    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: USER.email, metadata: { supabase_user_id: USER.id } })
    );
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new", mode: "subscription" })
    );
  });

  it("reuses an existing Stripe customer without creating a new one", async () => {
    fromQueue = [{ data: { stripe_customer_id: "cus_existing" }, error: null }];
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(200);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_existing" }));
  });

  it("creates a fresh customer when the stored one doesn't exist in this Stripe account", async () => {
    fromQueue = [{ data: { stripe_customer_id: "cus_stale" }, error: null }, { error: null }];
    retrieveCustomer.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({ code: "resource_missing", message: "No such customer" })
    );
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(200);
    expect(createCustomer).toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_new" }));
  });

  it("400s instead of double-subscribing when Stripe already shows an active subscription for this customer", async () => {
    fromQueue = [{ data: { stripe_customer_id: "cus_existing" }, error: null }];
    listSubscriptions.mockResolvedValueOnce({ data: [{ id: "sub_1", status: "active" }] });
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("400s for a past_due subscription too, not just active/trialing", async () => {
    // A payment hiccup mid-retry is still a real, non-terminal subscription
    // -- a second Checkout would run alongside it, not fix it; Manage
    // billing (updating the payment method) is the right path instead.
    fromQueue = [{ data: { stripe_customer_id: "cus_existing" }, error: null }];
    listSubscriptions.mockResolvedValueOnce({ data: [{ id: "sub_1", status: "past_due" }] });
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("allows a fresh checkout when the only prior subscription is fully canceled", async () => {
    fromQueue = [{ data: { stripe_customer_id: "cus_existing" }, error: null }];
    listSubscriptions.mockResolvedValueOnce({ data: [{ id: "sub_1", status: "canceled" }] });
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalled();
  });
});
