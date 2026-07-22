import { beforeEach, describe, expect, it, vi } from "vitest";

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

const createPortalSession = vi.fn(async () => ({ url: "https://billing.stripe.com/portal123" }));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    billingPortal: {
      sessions: { create: (...args: Parameters<typeof createPortalSession>) => createPortalSession(...args) },
    },
  })),
}));

import { POST } from "./route";

const USER = { id: "user-1", email: "parent@example.com" };

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: USER } };
    fromQueue = [];
  });

  it("rejects when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("400s when there's no Stripe customer yet", async () => {
    fromQueue = [{ data: null, error: null }];
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it("creates a portal session for an existing customer", async () => {
    fromQueue = [{ data: { stripe_customer_id: "cus_existing" }, error: null }];
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://billing.stripe.com/portal123");
    expect(createPortalSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_existing" }));
  });
});
