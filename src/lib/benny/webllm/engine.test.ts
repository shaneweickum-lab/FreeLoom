import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMLCEngineMock = vi.fn<(modelId: string, config?: unknown) => Promise<unknown>>();
vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: (modelId: string, config?: unknown) => createMLCEngineMock(modelId, config),
}));

const detectWebGpuCapabilityMock = vi.fn<() => Promise<{ supported: boolean; supportsShaderF16: boolean; maxBufferSizeBytes: number | null }>>();
const pickQuantVariantMock = vi.fn<(tier: unknown, capability: unknown) => "q4f16_1" | "q4f32_1" | null>();
vi.mock("./capabilities", () => ({
  detectWebGpuCapability: () => detectWebGpuCapabilityMock(),
  pickQuantVariant: (tier: unknown, capability: unknown) => pickQuantVariantMock(tier, capability),
}));

import { getBennyEngine, resetBennyEngine, unloadAllBennyEngines } from "./engine";

const SUPPORTED_CAPABILITY = { supported: true, supportsShaderF16: true, maxBufferSizeBytes: 2_000_000_000 };

const FAKE_TIER = {
  modelIds: { q4f16_1: "Fake-Model-q4f16_1-MLC", q4f32_1: "Fake-Model-q4f32_1-MLC" },
  vramRequiredMB: { q4f16_1: 500, q4f32_1: 700 },
  label: "Fake Model",
};

function makeEngine(id: string) {
  return { id, unload: vi.fn(async () => {}) };
}

describe("getBennyEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectWebGpuCapabilityMock.mockResolvedValue(SUPPORTED_CAPABILITY);
    pickQuantVariantMock.mockReturnValue("q4f16_1");
  });

  afterEach(async () => {
    await unloadAllBennyEngines();
  });

  it("returns null with 'unsupported-device' when no quantization fits, without ever calling CreateMLCEngine", async () => {
    pickQuantVariantMock.mockReturnValue(null);
    const result = await getBennyEngine("chat", FAKE_TIER);
    expect(result).toEqual({ engine: null, reason: "unsupported-device" });
    expect(createMLCEngineMock).not.toHaveBeenCalled();
  });

  it("loads and returns a real engine on success", async () => {
    const engine = makeEngine("chat-engine");
    createMLCEngineMock.mockResolvedValue(engine);
    const result = await getBennyEngine("chat", FAKE_TIER);
    expect(result).toEqual({ engine, sharedFallback: false });
    expect(createMLCEngineMock).toHaveBeenCalledWith("Fake-Model-q4f16_1-MLC", expect.any(Object));
  });

  it("caches a role's result -- a second call doesn't call CreateMLCEngine again", async () => {
    createMLCEngineMock.mockResolvedValue(makeEngine("chat-engine"));
    await getBennyEngine("chat", FAKE_TIER);
    await getBennyEngine("chat", FAKE_TIER);
    expect(createMLCEngineMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes two concurrent callers for the same still-loading role into one CreateMLCEngine call", async () => {
    let resolveEngine: (engine: unknown) => void;
    createMLCEngineMock.mockReturnValue(new Promise((resolve) => (resolveEngine = resolve)));

    const first = getBennyEngine("chat", FAKE_TIER);
    const second = getBennyEngine("chat", FAKE_TIER);
    resolveEngine!(makeEngine("chat-engine"));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(createMLCEngineMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to sharing another role's already-loaded engine when this role's load fails", async () => {
    const pipelineEngine = makeEngine("pipeline-engine");
    createMLCEngineMock.mockResolvedValueOnce(pipelineEngine);
    await getBennyEngine("pipeline", FAKE_TIER);

    createMLCEngineMock.mockRejectedValueOnce(new Error("out of memory"));
    const chatResult = await getBennyEngine("chat", FAKE_TIER);

    expect(chatResult).toEqual({ engine: pipelineEngine, sharedFallback: true });
  });

  it("returns 'load-failed' when this role fails and no other role has a loaded engine to share", async () => {
    createMLCEngineMock.mockRejectedValueOnce(new Error("out of memory"));
    const result = await getBennyEngine("chat", FAKE_TIER);
    expect(result).toEqual({ engine: null, reason: "load-failed" });
  });

  it("resetBennyEngine allows a genuinely fresh retry instead of replaying a cached failure", async () => {
    createMLCEngineMock.mockRejectedValueOnce(new Error("boom"));
    const first = await getBennyEngine("chat", FAKE_TIER);
    expect(first.engine).toBeNull();

    resetBennyEngine("chat");

    const engine = makeEngine("chat-engine-retry");
    createMLCEngineMock.mockResolvedValueOnce(engine);
    const second = await getBennyEngine("chat", FAKE_TIER);
    expect(second).toEqual({ engine, sharedFallback: false });
    expect(createMLCEngineMock).toHaveBeenCalledTimes(2);
  });
});

describe("unloadAllBennyEngines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectWebGpuCapabilityMock.mockResolvedValue(SUPPORTED_CAPABILITY);
    pickQuantVariantMock.mockReturnValue("q4f16_1");
  });

  it("unloads every distinct loaded engine and clears cached results", async () => {
    const chatEngine = makeEngine("chat-engine");
    const pipelineEngine = makeEngine("pipeline-engine");
    createMLCEngineMock.mockResolvedValueOnce(chatEngine).mockResolvedValueOnce(pipelineEngine);

    await getBennyEngine("chat", FAKE_TIER);
    await getBennyEngine("pipeline", FAKE_TIER);
    await unloadAllBennyEngines();

    expect(chatEngine.unload).toHaveBeenCalledTimes(1);
    expect(pipelineEngine.unload).toHaveBeenCalledTimes(1);

    // A cleared cache means the next call genuinely reloads.
    createMLCEngineMock.mockResolvedValueOnce(makeEngine("chat-engine-2"));
    await getBennyEngine("chat", FAKE_TIER);
    expect(createMLCEngineMock).toHaveBeenCalledTimes(3);
  });

  it("only unloads a shared engine once even though two roles point at it", async () => {
    const sharedEngine = makeEngine("shared-engine");
    createMLCEngineMock.mockResolvedValueOnce(sharedEngine).mockRejectedValueOnce(new Error("oom"));

    await getBennyEngine("pipeline", FAKE_TIER);
    await getBennyEngine("chat", FAKE_TIER); // fails, shares pipeline's engine
    await unloadAllBennyEngines();

    expect(sharedEngine.unload).toHaveBeenCalledTimes(1);
  });
});
