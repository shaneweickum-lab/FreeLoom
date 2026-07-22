/**
 * Loads and caches the weight files export_web_weights.py produces
 * (ml/serve/export_web_weights.py) -- committed into this directory so
 * Next.js bundles them with the app (see that directory's own README for
 * how they get here). Cached at module scope: a warm Vercel function
 * instance reuses the same loaded weights across requests instead of
 * re-parsing ~57MB of safetensors on every call.
 */

import fs from "node:fs";
import path from "node:path";
import { parseSafetensors, requireTensor, type TensorMap } from "./safetensors";
import { MODEL_CONFIG, LORA_RANK } from "./config";
import type { LoraParams } from "./math";

const WEIGHTS_DIR = path.join(process.cwd(), "src", "lib", "benny", "inference", "weights");

export interface LayerWeights {
  ln1Gamma: Float32Array;
  ln1Beta: Float32Array;
  ln2Gamma: Float32Array;
  ln2Beta: Float32Array;
  qkvWeight: Float32Array;
  outProjWeight: Float32Array;
  fcInWeight: Float32Array;
  fcOutWeight: Float32Array;
}

export interface BaseWeights {
  tokenEmb: Float32Array;
  posEmb: Float32Array;
  lnFGamma: Float32Array;
  lnFBeta: Float32Array;
  layers: LayerWeights[];
}

export interface AdapterLayer {
  qkv: LoraParams;
  outProj: LoraParams;
  fcIn: LoraParams;
  fcOut: LoraParams;
}

export interface AdapterWeights {
  layers: AdapterLayer[];
}

export type AdapterTask = "entry_drafting" | "platform_help";

let cachedBase: BaseWeights | null = null;
const cachedAdapters = new Map<AdapterTask, AdapterWeights>();

function loadTensorFile(filename: string): TensorMap {
  const filePath = path.join(WEIGHTS_DIR, filename);
  const buffer = fs.readFileSync(filePath);
  return parseSafetensors(buffer);
}

export function loadBaseWeights(): BaseWeights {
  if (cachedBase) return cachedBase;
  const raw = loadTensorFile("base.safetensors");
  const layers: LayerWeights[] = [];
  for (let i = 0; i < MODEL_CONFIG.nLayers; i++) {
    layers.push({
      ln1Gamma: requireTensor(raw, `blocks.${i}.ln1.weight`).data,
      ln1Beta: requireTensor(raw, `blocks.${i}.ln1.bias`).data,
      ln2Gamma: requireTensor(raw, `blocks.${i}.ln2.weight`).data,
      ln2Beta: requireTensor(raw, `blocks.${i}.ln2.bias`).data,
      qkvWeight: requireTensor(raw, `blocks.${i}.attn.qkv.weight`).data,
      outProjWeight: requireTensor(raw, `blocks.${i}.attn.out_proj.weight`).data,
      fcInWeight: requireTensor(raw, `blocks.${i}.mlp.fc_in.weight`).data,
      fcOutWeight: requireTensor(raw, `blocks.${i}.mlp.fc_out.weight`).data,
    });
  }
  cachedBase = {
    tokenEmb: requireTensor(raw, "token_emb.weight").data,
    posEmb: requireTensor(raw, "pos_emb.weight").data,
    lnFGamma: requireTensor(raw, "ln_f.weight").data,
    lnFBeta: requireTensor(raw, "ln_f.bias").data,
    layers,
  };
  return cachedBase;
}

/** Whether this deployment actually has `task`'s weight files bundled --
 * what flags.ts's isSlmEntryDraftingEnabled()/isSlmChatEnabled() check,
 * now that inference runs in-process instead of depending on an external
 * SLM_ENTRY_DRAFTING_URL/SLM_CHAT_URL server being configured. */
export function hasWeights(task: AdapterTask): boolean {
  return fs.existsSync(path.join(WEIGHTS_DIR, "base.safetensors")) && fs.existsSync(path.join(WEIGHTS_DIR, `${task}_lora.safetensors`));
}

export function loadAdapterWeights(task: AdapterTask): AdapterWeights {
  const cached = cachedAdapters.get(task);
  if (cached) return cached;
  const raw = loadTensorFile(`${task}_lora.safetensors`);
  const layers: AdapterLayer[] = [];
  const lora = (i: number, group: string, proj: string): LoraParams => ({
    a: requireTensor(raw, `block${i}.${group}.${proj}.lora_a`).data,
    b: requireTensor(raw, `block${i}.${group}.${proj}.lora_b`).data,
    rank: LORA_RANK,
  });
  for (let i = 0; i < MODEL_CONFIG.nLayers; i++) {
    layers.push({
      qkv: lora(i, "attn", "qkv"),
      outProj: lora(i, "attn", "out_proj"),
      fcIn: lora(i, "mlp", "fc_in"),
      fcOut: lora(i, "mlp", "fc_out"),
    });
  }
  const adapter: AdapterWeights = { layers };
  cachedAdapters.set(task, adapter);
  return adapter;
}
