import { describe, expect, it, vi } from "vitest";
import { isHouseholdOwner, resolveHouseholdOwnerId } from "./household";

type QueryResult = { data: unknown; error: unknown };

function makeSupabaseMock(bySelectTable: Record<string, QueryResult>) {
  const from = vi.fn((table: string) => {
    const result = bySelectTable[table] ?? { data: null, error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(result),
    };
    return chain;
  });
  return { from } as unknown as Parameters<typeof resolveHouseholdOwnerId>[0];
}

describe("resolveHouseholdOwnerId", () => {
  it("returns the user's own id when they own a school_profiles row", async () => {
    const supabase = makeSupabaseMock({ school_profiles: { data: { user_id: "owner-1" }, error: null } });
    const result = await resolveHouseholdOwnerId(supabase, "owner-1");
    expect(result).toBe("owner-1");
  });

  it("returns the inviting owner's id for an accepted household member", async () => {
    const supabase = makeSupabaseMock({
      school_profiles: { data: null, error: null },
      household_members: { data: { owner_user_id: "owner-1" }, error: null },
    });
    const result = await resolveHouseholdOwnerId(supabase, "guardian-1");
    expect(result).toBe("owner-1");
  });

  it("returns null for an account with no school_profiles row and no accepted membership", async () => {
    const supabase = makeSupabaseMock({
      school_profiles: { data: null, error: null },
      household_members: { data: null, error: null },
    });
    const result = await resolveHouseholdOwnerId(supabase, "brand-new-user");
    expect(result).toBeNull();
  });
});

describe("isHouseholdOwner", () => {
  it("is true when the ids match", () => {
    expect(isHouseholdOwner("owner-1", "owner-1")).toBe(true);
  });

  it("is false for a non-owning household member", () => {
    expect(isHouseholdOwner("guardian-1", "owner-1")).toBe(false);
  });

  it("is false when there's no household at all", () => {
    expect(isHouseholdOwner("brand-new-user", null)).toBe(false);
  });
});
