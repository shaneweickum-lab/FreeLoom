import { beforeEach, describe, expect, it, vi } from "vitest";

const isSlmEntryDraftingEnabledMock = vi.fn(() => true);
vi.mock("@/lib/flags", () => ({
  isSlmEntryDraftingEnabled: () => isSlmEntryDraftingEnabledMock(),
}));

const draftEntryMock = vi.fn();
vi.mock("@/lib/benny/inference/model", () => ({
  draftEntry: (...args: unknown[]) => draftEntryMock(...args),
}));

import { callEntryDraftingAdapter, validateDraftCandidate } from "./slmDraft";

const VALID_CANDIDATE = {
  subjectArea: "Mathematics",
  courseTitle: "Applied Algebra",
  creditValue: 0.25,
  rationale: "Working through algebra problems builds core mathematical reasoning skills.",
};

describe("validateDraftCandidate", () => {
  it("accepts a well-formed candidate", () => {
    expect(validateDraftCandidate(VALID_CANDIDATE)).toBe(true);
  });

  it("rejects a non-object candidate", () => {
    expect(validateDraftCandidate(null)).toBe(false);
    expect(validateDraftCandidate("nope")).toBe(false);
    expect(validateDraftCandidate(undefined)).toBe(false);
  });

  it("rejects a candidate missing any required string field", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, subjectArea: "" })).toBe(false);
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, courseTitle: "   " })).toBe(false);
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, rationale: undefined })).toBe(false);
  });

  it("rejects a non-numeric or NaN creditValue", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, creditValue: "0.25" })).toBe(false);
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, creditValue: NaN })).toBe(false);
  });

  it("rejects a creditValue outside the plausible 0.05-1.0 range", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, creditValue: 0.01 })).toBe(false);
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, creditValue: 1.5 })).toBe(false);
  });

  it("rejects a too-short course title", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, courseTitle: "Art" })).toBe(false);
  });

  it("rejects a generic, low-information course title", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, courseTitle: "General Studies" })).toBe(false);
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, courseTitle: "Activity" })).toBe(false);
  });

  it("rejects a too-short rationale", () => {
    expect(validateDraftCandidate({ ...VALID_CANDIDATE, rationale: "Because math." })).toBe(false);
  });
});

describe("callEntryDraftingAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSlmEntryDraftingEnabledMock.mockReturnValue(true);
  });

  it("returns null without calling the model when the feature flag is off", async () => {
    isSlmEntryDraftingEnabledMock.mockReturnValue(false);
    const result = await callEntryDraftingAdapter({ rawWordDump: "text", extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null } });
    expect(result).toBeNull();
    expect(draftEntryMock).not.toHaveBeenCalled();
  });

  it("returns the validated candidate when the model produces one", async () => {
    draftEntryMock.mockReturnValue(VALID_CANDIDATE);
    const result = await callEntryDraftingAdapter({ rawWordDump: "did algebra", extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null } });
    expect(result).toEqual(VALID_CANDIDATE);
    expect(draftEntryMock).toHaveBeenCalledWith("did algebra");
  });

  it("returns null when the model itself returns nothing", async () => {
    draftEntryMock.mockReturnValue(null);
    const result = await callEntryDraftingAdapter({ rawWordDump: "text", extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null } });
    expect(result).toBeNull();
  });

  it("returns null when the model's output fails validation (e.g. out-of-range credit)", async () => {
    draftEntryMock.mockReturnValue({ ...VALID_CANDIDATE, creditValue: 5 });
    const result = await callEntryDraftingAdapter({ rawWordDump: "text", extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null } });
    expect(result).toBeNull();
  });

  it("returns null instead of throwing when the model call itself throws", async () => {
    draftEntryMock.mockImplementation(() => {
      throw new Error("inference failed");
    });
    const result = await callEntryDraftingAdapter({ rawWordDump: "text", extractedSlots: { activity_type: null, source_platform: null, time_spent_minutes: null } });
    expect(result).toBeNull();
  });
});
