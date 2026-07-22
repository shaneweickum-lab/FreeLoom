import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import Stripe from "stripe";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
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

const retrieveSubscription = vi.fn(async () => ({
  items: { data: [{ id: "si_1", price: { id: "price_old" } }] },
}));
const updateSubscription = vi.fn(async () => ({}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: {
      retrieve: (...args: Parameters<typeof retrieveSubscription>) => retrieveSubscription(...args),
      update: (...args: Parameters<typeof updateSubscription>) => updateSubscription(...args),
    },
  })),
  priceIdFor: vi.fn((tier: string, interval: string) => {
    if (tier === "premium" && interval === "quarter") return "price_premium_quarter";
    if (tier === "pro" && interval === "month") return "price_pro_month";
    return undefined;
  }),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const USER = { id: "user-1", email: "parent@example.com" };
const ACTIVE_PRO_MONTHLY = {
  data: {
    stripe_subscription_id: "sub_1",
    subscription_status: "active",
    subscription_tier: "pro",
    billing_interval: "month",
  },
  error: null,
};

describe("POST /api/billing/change-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ tier: "premium", interval: "quarter" }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid tier/interval", async () => {
    const res = await POST(makeRequest({ tier: "gold", interval: "quarter" }));
    expect(res.status).toBe(400);
  });

  it("500s when the plan has no configured Price ID", async () => {
    const res = await POST(makeRequest({ tier: "pro", interval: "year" }));
    expect(res.status).toBe(500);
  });

  it("400s when there's no active subscription to change", async () => {
    fromQueue = [{ data: { stripe_subscription_id: null, subscription_status: null }, error: null }];
    const res = await POST(makeRequest({ tier: "premium", interval: "quarter" }));
    expect(res.status).toBe(400);
  });

  it("400s when already on the requested plan", async () => {
    fromQueue = [ACTIVE_PRO_MONTHLY];
    const res = await POST(makeRequest({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(400);
  });

  it("updates the existing subscription in place, charging immediately and clearing any pending cancellation", async () => {
    fromQueue = [ACTIVE_PRO_MONTHLY];
    const res = await POST(makeRequest({ tier: "premium", interval: "quarter" }));
    expect(res.status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(updateSubscription).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        items: [{ id: "si_1", price: "price_premium_quarter" }],
        // create_prorations defers the charge to the next scheduled
        // invoice -- always_invoice charges it now, closing a window
        // where a customer could upgrade for instant access then switch
        // back down before ever paying the difference.
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        cancel_at_period_end: false,
        cancel_at: null,
      })
    );
  });

  it("402s with a clean message when the prorated charge is declined", async () => {
    fromQueue = [ACTIVE_PRO_MONTHLY];
    updateSubscription.mockRejectedValueOnce(
      new Stripe.errors.StripeCardError({ code: "card_declined", message: "Your card was declined." })
    );
    const res = await POST(makeRequest({ tier: "premium", interval: "quarter" }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toMatch(/payment method/i);
  });
});
