import { describe, expect, it } from "vitest";
import { HEAD_DIM, LORA_ALPHA, LORA_RANK, LORA_SCALE, MLP_DIM, MODEL_CONFIG } from "./config";

describe("model config derived constants", () => {
  it("derives HEAD_DIM as dModel / nHeads", () => {
    expect(HEAD_DIM).toBe(MODEL_CONFIG.dModel / MODEL_CONFIG.nHeads);
    expect(Number.isInteger(HEAD_DIM)).toBe(true);
  });

  it("derives MLP_DIM as dModel * mlpRatio", () => {
    expect(MLP_DIM).toBe(MODEL_CONFIG.dModel * MODEL_CONFIG.mlpRatio);
  });

  it("derives LORA_SCALE as alpha / rank", () => {
    expect(LORA_SCALE).toBe(LORA_ALPHA / LORA_RANK);
  });
});
