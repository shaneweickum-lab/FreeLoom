import { beforeEach, describe, expect, it, vi } from "vitest";

let getUserResult: { data: { user: { id: string; email: string } | null } };
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: fromMock,
  })),
}));

import { requireAdmin } from "./adminAuth";

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isAdmin: false and user: null when signed out, without querying admin_users", async () => {
    getUserResult = { data: { user: null } };
    const result = await requireAdmin();
    expect(result.user).toBeNull();
    expect(result.isAdmin).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns isAdmin: true when the admin_users lookup finds a row", async () => {
    getUserResult = { data: { user: { id: "user-1", email: "admin@example.com" } } };
    maybeSingleMock.mockResolvedValue({ data: { user_id: "user-1" } });
    const result = await requireAdmin();
    expect(result.isAdmin).toBe(true);
    expect(result.user?.id).toBe("user-1");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns isAdmin: false for a signed-in user with no admin_users row", async () => {
    getUserResult = { data: { user: { id: "user-2", email: "parent@example.com" } } };
    maybeSingleMock.mockResolvedValue({ data: null });
    const result = await requireAdmin();
    expect(result.isAdmin).toBe(false);
    expect(result.user?.id).toBe("user-2");
  });

  it("still returns the real supabase client either way, for the caller's own subsequent queries", async () => {
    getUserResult = { data: { user: { id: "user-1", email: "admin@example.com" } } };
    maybeSingleMock.mockResolvedValue({ data: { user_id: "user-1" } });
    const result = await requireAdmin();
    expect(result.supabase).toBeTruthy();
  });
});
