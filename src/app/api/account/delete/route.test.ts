import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let getUserResult: { data: { user: { id: string } | null } };
let fromQueue: unknown[];
const deleteUserMock = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
const storageRemove = vi.fn(async () => ({ data: null, error: null }));
const storageList = vi.fn(async () => ({ data: [], error: null }));
const stripeCustomersDel = vi.fn(async () => ({ deleted: true }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => chain(fromQueue.shift() ?? { error: null })),
    storage: {
      from: vi.fn(() => ({ remove: storageRemove, list: storageList })),
    },
    auth: { admin: { deleteUser: deleteUserMock } },
  })),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    customers: { del: stripeCustomersDel },
  })),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserResult = { data: { user: { id: "user-1" } } };
    fromQueue = [];
    deleteUserMock.mockResolvedValue({ error: null });
    storageList.mockResolvedValue({ data: [], error: null });
    stripeCustomersDel.mockResolvedValue({ deleted: true });
  });

  it("401s when signed out", async () => {
    getUserResult = { data: { user: null } };
    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(401);
  });

  it("400s when the confirmation text doesn't match", async () => {
    const res = await POST(makeRequest({ confirmation: "delete" }));
    expect(res.status).toBe(400);
  });

  it("deletes everything and the Auth user for an account with no students or Stripe customer", async () => {
    fromQueue = [
      { data: [], error: null }, // students select -- none
      { error: null }, // notifications
      { error: null }, // support_messages
      { error: null }, // support_threads
      { error: null }, // benny_messages
      { error: null }, // benny_conversations
      { error: null }, // account_access_requests
      { error: null }, // admin_users
      { data: [{ stripe_customer_id: null }], error: null }, // school_profiles select (billing)
      { error: null }, // school_profiles delete
    ];

    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true });
    expect(deleteUserMock).toHaveBeenCalledWith("user-1");
    expect(stripeCustomersDel).not.toHaveBeenCalled();
  });

  it("cancels the Stripe subscription (by deleting the Customer) before deleting the account", async () => {
    fromQueue = [
      { data: [], error: null }, // students select -- none
      { error: null }, // notifications
      { error: null }, // support_messages
      { error: null }, // support_threads
      { error: null }, // benny_messages
      { error: null }, // benny_conversations
      { error: null }, // account_access_requests
      { error: null }, // admin_users
      { data: [{ stripe_customer_id: "cus_123" }], error: null }, // school_profiles select (billing)
      { error: null }, // school_profiles delete
    ];

    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(stripeCustomersDel).toHaveBeenCalledWith("cus_123");
    expect(deleteUserMock).toHaveBeenCalledWith("user-1");
  });

  it("500s and never deletes school_profiles or Auth if Stripe cancellation fails", async () => {
    fromQueue = [
      { data: [], error: null }, // students select -- none
      { error: null }, // notifications
      { error: null }, // support_messages
      { error: null }, // support_threads
      { error: null }, // benny_messages
      { error: null }, // benny_conversations
      { error: null }, // account_access_requests
      { error: null }, // admin_users
      { data: [{ stripe_customer_id: "cus_123" }], error: null }, // school_profiles select (billing)
    ];
    stripeCustomersDel.mockRejectedValue(new Error("Stripe unreachable"));

    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/canceling your subscription/);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("500s on a mid-sequence DB failure and never touches Auth", async () => {
    fromQueue = [
      { data: [{ id: "student-1" }], error: null }, // students select
      { data: [], error: null }, // entries select -- none, skip step1/storage
      { data: [], error: null }, // transcripts select -- none
      { error: null }, // entry_subject_tags delete
      { error: { message: "connection reset" } }, // entries delete -- fails
    ];

    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/deleting entries/);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("500s with a distinct message when data is deleted but closing the Auth login fails", async () => {
    fromQueue = [
      { data: [], error: null }, // students select -- none
      { error: null }, // notifications
      { error: null }, // support_messages
      { error: null }, // support_threads
      { error: null }, // benny_messages
      { error: null }, // benny_conversations
      { error: null }, // account_access_requests
      { error: null }, // admin_users
      { data: [{ stripe_customer_id: null }], error: null }, // school_profiles select (billing)
      { error: null }, // school_profiles delete
    ];
    deleteUserMock.mockResolvedValue({ error: { message: "auth service unreachable" } });

    const res = await POST(makeRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/closing the login itself failed/);
  });
});
