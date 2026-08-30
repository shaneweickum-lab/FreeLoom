import { beforeEach, describe, expect, it, vi } from "vitest";

const getBennyEngineMock = vi.fn<(role: string, tier: unknown) => Promise<{ engine: unknown; sharedFallback?: boolean; reason?: string }>>();
vi.mock("@/lib/benny/webllm/engine", () => ({
  getBennyEngine: (role: string, tier: unknown) => getBennyEngineMock(role, tier),
}));

const agreesWithClassicalClassifierMock = vi.fn<(subjectArea: string, rawWordDump: string) => boolean>(() => true);
vi.mock("@/lib/pipeline/subjectClassifier", () => ({
  agreesWithClassicalClassifier: (subjectArea: string, rawWordDump: string) =>
    agreesWithClassicalClassifierMock(subjectArea, rawWordDump),
}));

import { draftEntryClientSide } from "./webllmDraft";

const VALID_COMPLETION_TEXT =
  "course_title: Applied Algebra\nsubject_area: Mathematics\ncredit_value: 0.25\nrationale: Working through algebra problems builds core mathematical reasoning skills.";

function makeEngine(completionText: string | (() => Promise<unknown>)) {
  const create =
    typeof completionText === "function"
      ? completionText
      : async () => ({ choices: [{ message: { content: completionText } }] });
  return { chat: { completions: { create } } };
}

describe("draftEntryClientSide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agreesWithClassicalClassifierMock.mockReturnValue(true);
  });

  it("returns null without attempting generation when no engine is available", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: null, reason: "unsupported-device" });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toBeNull();
  });

  it("parses a well-formed completion into a validated candidate", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine(VALID_COMPLETION_TEXT) });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toEqual({
      subjectArea: "Mathematics",
      courseTitle: "Applied Algebra",
      creditValue: 0.25,
      rationale: "Working through algebra problems builds core mathematical reasoning skills.",
    });
  });

  it("requests the pipeline-role engine with the Llama 3.2 1B tier", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine(VALID_COMPLETION_TEXT) });
    await draftEntryClientSide("did some algebra");
    expect(getBennyEngineMock).toHaveBeenCalledWith("pipeline", expect.objectContaining({ label: "Llama 3.2 1B" }));
  });

  it("returns null when the completion doesn't match the expected four-line format", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine("Sure, here's a draft for you!") });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toBeNull();
  });

  it("returns null when the parsed candidate fails shape validation (e.g. out-of-range credit)", async () => {
    const badCredit = VALID_COMPLETION_TEXT.replace("credit_value: 0.25", "credit_value: 5");
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine(badCredit) });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toBeNull();
  });

  it("returns null when the classical subject-area classifier disagrees, without ever being called before validation passes", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine(VALID_COMPLETION_TEXT) });
    agreesWithClassicalClassifierMock.mockReturnValue(false);
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toBeNull();
    expect(agreesWithClassicalClassifierMock).toHaveBeenCalledWith("Mathematics", "did some algebra");
  });

  it("returns null instead of throwing when the engine call itself throws", async () => {
    getBennyEngineMock.mockResolvedValue({
      engine: makeEngine(async () => {
        throw new Error("generation failed");
      }),
    });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).toBeNull();
  });

  it("still resolves a candidate when falling back to a shared engine instance", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine(VALID_COMPLETION_TEXT), sharedFallback: true });
    const result = await draftEntryClientSide("did some algebra");
    expect(result).not.toBeNull();
  });
});
