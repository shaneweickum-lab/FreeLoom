import { beforeEach, describe, expect, it, vi } from "vitest";

const getBennyEngineMock = vi.fn<(role: string, tier: unknown) => Promise<{ engine: unknown }>>();
vi.mock("./engine", () => ({
  getBennyEngine: (role: string, tier: unknown) => getBennyEngineMock(role, tier),
}));

const chatTierForMock = vi.fn<(isMobile: boolean) => unknown>(() => ({ label: "Llama 3.2 1B" }));
vi.mock("./capabilities", () => ({
  chatTierFor: (isMobile: boolean) => chatTierForMock(isMobile),
}));

import { generateBennyReply } from "./chatCompletion";

function makeEngine(reply: string | ((args: unknown) => Promise<unknown>)) {
  const create = typeof reply === "function" ? reply : async () => ({ choices: [{ message: { content: reply } }] });
  return { chat: { completions: { create } } };
}

describe("generateBennyReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatTierForMock.mockReturnValue({ label: "Llama 3.2 1B" });
  });

  it("returns the model's reply on success", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine("Hi there!") });
    const reply = await generateBennyReply([{ role: "user", content: "hi" }], { isMobile: false });
    expect(reply).toBe("Hi there!");
  });

  it("picks the mobile tier when isMobile is true", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine("Hi there!") });
    await generateBennyReply([{ role: "user", content: "hi" }], { isMobile: true });
    expect(chatTierForMock).toHaveBeenCalledWith(true);
  });

  it("returns an honest unavailable message when no engine loaded, without throwing", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: null });
    const reply = await generateBennyReply([{ role: "user", content: "hi" }], { isMobile: false });
    expect(reply).toContain("WebGPU");
  });

  it("returns a trouble message instead of throwing when generation itself fails", async () => {
    getBennyEngineMock.mockResolvedValue({
      engine: makeEngine(async () => {
        throw new Error("boom");
      }),
    });
    const reply = await generateBennyReply([{ role: "user", content: "hi" }], { isMobile: false });
    expect(reply).toBe("Benny's having trouble answering right now -- try again in a bit.");
  });

  it("returns a trouble message when the model's reply is empty", async () => {
    getBennyEngineMock.mockResolvedValue({ engine: makeEngine("   ") });
    const reply = await generateBennyReply([{ role: "user", content: "hi" }], { isMobile: false });
    expect(reply).toBe("Benny's having trouble answering right now -- try again in a bit.");
  });

  it("includes retrieved context in the system prompt when provided", async () => {
    let capturedMessages: unknown;
    getBennyEngineMock.mockResolvedValue({
      engine: makeEngine(async (args: unknown) => {
        capturedMessages = (args as { messages: unknown }).messages;
        return { choices: [{ message: { content: "ok" } }] };
      }),
    });
    await generateBennyReply([{ role: "user", content: "how do credits work?" }], {
      isMobile: false,
      extraContext: "Credits use the Carnegie unit convention.",
    });
    expect(JSON.stringify(capturedMessages)).toContain("Carnegie unit convention");
  });
});
