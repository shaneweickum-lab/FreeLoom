import { describe, expect, it } from "vitest";
import { hasWeights, loadAdapterWeights, loadBaseWeights } from "./weights";
import { MODEL_CONFIG } from "./config";

// Deliberately loads the REAL bundled .safetensors files committed to this
// directory, not fixtures -- this is exactly the file this app actually
// serves entry_drafting/platform_help inference from in production, so a
// test against a fake file wouldn't catch a real problem with the real one.

describe("hasWeights", () => {
  it("is true for the two adapters actually bundled with this deployment", () => {
    expect(hasWeights("entry_drafting")).toBe(true);
    expect(hasWeights("platform_help")).toBe(true);
  });

  it("is false for kb_authoring -- it has no bundled weight file yet", () => {
    // Cast: kb_authoring isn't a valid AdapterTask (only entry_drafting/
    // platform_help are wired for serving), but hasWeights takes any
    // string task name, so this documents/confirms that gap directly
    // against the real weights/ directory contents.
    expect(hasWeights("kb_authoring" as Parameters<typeof hasWeights>[0])).toBe(false);
  });
});

describe("loadBaseWeights", () => {
  it("loads one LayerWeights entry per configured transformer layer", () => {
    const base = loadBaseWeights();
    expect(base.layers).toHaveLength(MODEL_CONFIG.nLayers);
  });

  it("loads token/position/output-projection tensors with non-trivial real data", () => {
    const base = loadBaseWeights();
    expect(base.tokenEmb.length).toBeGreaterThan(0);
    expect(base.posEmb.length).toBeGreaterThan(0);
    expect(base.lmHeadWeight.length).toBeGreaterThan(0);
    // Real trained weights are never all-zero.
    expect(Array.from(base.tokenEmb.subarray(0, 100)).some((v) => v !== 0)).toBe(true);
  });

  it("token_emb and lm_head_weight have drifted apart during training, not tied", () => {
    // See BaseWeights.lmHeadWeight's own doc comment -- MLX only aliases
    // these at construction; training makes them diverge. A real bug where
    // export accidentally re-tied them would silently break output quality
    // without this ever showing up as a parse error.
    const base = loadBaseWeights();
    expect(base.tokenEmb.length).toBe(base.lmHeadWeight.length);
    let identical = true;
    for (let i = 0; i < base.tokenEmb.length; i++) {
      if (base.tokenEmb[i] !== base.lmHeadWeight[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });

  it("caches the parsed result across calls instead of re-reading the file", () => {
    const first = loadBaseWeights();
    const second = loadBaseWeights();
    expect(second).toBe(first);
  });
});

describe("loadAdapterWeights", () => {
  it("loads one AdapterLayer per configured transformer layer, for each bundled adapter", () => {
    for (const task of ["entry_drafting", "platform_help"] as const) {
      const adapter = loadAdapterWeights(task);
      expect(adapter.layers).toHaveLength(MODEL_CONFIG.nLayers);
      for (const layer of adapter.layers) {
        for (const proj of [layer.qkv, layer.outProj, layer.fcIn, layer.fcOut]) {
          expect(proj.a.length).toBeGreaterThan(0);
          expect(proj.b.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("caches per-task, so loading one adapter doesn't return another's weights", () => {
    const entryDrafting = loadAdapterWeights("entry_drafting");
    const platformHelp = loadAdapterWeights("platform_help");
    expect(entryDrafting).not.toBe(platformHelp);
    expect(Array.from(entryDrafting.layers[0].qkv.a.subarray(0, 20))).not.toEqual(
      Array.from(platformHelp.layers[0].qkv.a.subarray(0, 20))
    );
  });
});
