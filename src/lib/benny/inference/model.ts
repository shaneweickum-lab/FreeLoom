/**
 * TS port of ml/model/transformer_mlx.py's forward pass + the greedy
 * decode loop shared by ml/eval/run_eval.py and ml/serve/inference_server.py
 * -- runs in-process inside FreeLoom's own Next.js server, no external Mac/
 * tunnel dependency. See ml/serve/export_web_weights.py for how the
 * checkpoints this reads were produced, and math.ts's LayerCache docs for
 * why this incrementally caches attention instead of recomputing the whole
 * sequence every step like the Python reference does.
 */

import {
  addResidual,
  argmax,
  bitLinearWithLora,
  causalSelfAttentionStep,
  createLayerCache,
  gelu,
  layerNorm,
  linear,
  type LayerCache,
} from "./math";
import { HEAD_DIM, LORA_SCALE, MAX_CONSECUTIVE_REPEATS, MLP_DIM, MODEL_CONFIG } from "./config";
import { loadAdapterWeights, loadBaseWeights, type AdapterLayer, type AdapterTask, type BaseWeights, type LayerWeights } from "./weights";
import { bosId, decode, encode, eosId } from "./tokenizer";

function forwardStep(
  tokenId: number,
  position: number,
  base: BaseWeights,
  adapter: AdapterLayer[] | null,
  caches: LayerCache[],
): Float32Array {
  const D = MODEL_CONFIG.dModel;
  let x: Float32Array<ArrayBufferLike> = new Float32Array(D);
  const tokOff = tokenId * D;
  const posOff = position * D;
  for (let i = 0; i < D; i++) x[i] = base.tokenEmb[tokOff + i] + base.posEmb[posOff + i];

  for (let i = 0; i < MODEL_CONFIG.nLayers; i++) {
    const layer: LayerWeights = base.layers[i];
    const loraLayer = adapter ? adapter[i] : null;

    const ln1 = layerNorm(x, 1, D, layer.ln1Gamma, layer.ln1Beta);
    const attnConcat = causalSelfAttentionStep(
      ln1,
      D,
      MODEL_CONFIG.nHeads,
      HEAD_DIM,
      layer.qkvWeight,
      loraLayer?.qkv ?? null,
      LORA_SCALE,
      caches[i],
    );
    const attnOut = bitLinearWithLora(attnConcat, 1, D, layer.outProjWeight, D, loraLayer?.outProj ?? null, LORA_SCALE);
    const afterAttn = addResidual(x, attnOut);

    const ln2 = layerNorm(afterAttn, 1, D, layer.ln2Gamma, layer.ln2Beta);
    const h = bitLinearWithLora(ln2, 1, D, layer.fcInWeight, MLP_DIM, loraLayer?.fcIn ?? null, LORA_SCALE);
    const activated = gelu(h);
    const mlpOut = bitLinearWithLora(activated, 1, MLP_DIM, layer.fcOutWeight, D, loraLayer?.fcOut ?? null, LORA_SCALE);
    x = addResidual(afterAttn, mlpOut);
  }

  const normed = layerNorm(x, 1, D, base.lnFGamma, base.lnFBeta);
  return linear(normed, 1, D, base.lmHeadWeight, MODEL_CONFIG.vocabSize);
}

/** Mirrors inference_server.py's generate(): greedy decode, stops at
 * max_new_tokens or the eos token (which is still appended before
 * stopping, matching the Python `ids.append(next_id); if ... break`
 * order). Caps at MODEL_CONFIG.maxSeqLen total positions -- the Python
 * reference instead slides its recompute window, which this incremental
 * cache can't cheaply do; not a real-world concern given how short both
 * Benny prompts and their outputs are relative to the 512-token limit. */
/** Runs just the prompt through the model (populating a fresh KV cache)
 * and returns the raw next-token logits -- exported for
 * ml/serve/verify_web_port.py's TS-side counterpart to compare directly
 * against the numpy reference's logits, one step before any argmax
 * decisions (and their downstream compounding) enter the picture. */
export function forwardLogitsForPrompt(
  promptIds: number[],
  base: BaseWeights,
  adapter: AdapterLayer[] | null,
): Float32Array {
  const caches = Array.from({ length: MODEL_CONFIG.nLayers }, () =>
    createLayerCache(MODEL_CONFIG.maxSeqLen, MODEL_CONFIG.dModel),
  );
  let lastLogits: Float32Array | null = null;
  for (let pos = 0; pos < promptIds.length; pos++) {
    lastLogits = forwardStep(promptIds[pos], pos, base, adapter, caches);
  }
  return lastLogits as Float32Array;
}

/** Exported (in addition to draftEntry/chatReply) for
 * ml/serve/verify_web_port.py's TS-side counterpart -- a numpy reference
 * implementation exists specifically to cross-check this port's math
 * token-for-token, and needs raw generated ids, not parsed/formatted
 * output, to do that. */
export function generate(
  promptIds: number[],
  maxNewTokens: number,
  base: BaseWeights,
  adapter: AdapterLayer[] | null,
): number[] {
  const caches = Array.from({ length: MODEL_CONFIG.nLayers }, () =>
    createLayerCache(MODEL_CONFIG.maxSeqLen, MODEL_CONFIG.dModel),
  );

  let lastLogits: Float32Array | null = null;
  for (let pos = 0; pos < promptIds.length; pos++) {
    lastLogits = forwardStep(promptIds[pos], pos, base, adapter, caches);
  }

  const stopId = eosId();
  const generated: number[] = [];
  let position = promptIds.length;
  let lastToken: number | null = null;
  let repeatCount = 0;
  for (let step = 0; step < maxNewTokens; step++) {
    const nextId = argmax(lastLogits as Float32Array);
    if (nextId === lastToken) {
      repeatCount += 1;
      // Greedy decoding can fall into a stable repetition loop -- stop
      // before adding another copy rather than repeating for the rest of
      // maxNewTokens (see MAX_CONSECUTIVE_REPEATS's own docs).
      if (repeatCount >= MAX_CONSECUTIVE_REPEATS) break;
    } else {
      lastToken = nextId;
      repeatCount = 1;
    }
    generated.push(nextId);
    if (nextId === stopId) break;
    if (position >= MODEL_CONFIG.maxSeqLen) break;
    lastLogits = forwardStep(nextId, position, base, adapter, caches);
    position += 1;
  }
  return generated;
}

/** tokens is promptIds.length + generatedIds.length -- total tokens this
 * call actually processed, the unit Benny's usage cap (src/lib/billing/
 * tier.ts) is measured in. Surfaced here rather than computed by a caller,
 * since generatedIds (needed for an accurate count) is discarded right
 * after decode() below. */
function runAdapter(task: AdapterTask, promptText: string, maxNewTokens: number): { text: string; tokens: number } {
  const base = loadBaseWeights();
  const adapter = loadAdapterWeights(task);
  const promptIds = [bosId(), ...encode(promptText)];
  const generatedIds = generate(promptIds, maxNewTokens, base, adapter.layers);
  // The byte-level BPE decoder (@huggingface/tokenizers) substitutes U+FFFD
  // for any incomplete/invalid UTF-8 byte sequence -- generation stopping
  // (repetition guard, hitting max_new_tokens, anything else) partway
  // through a multi-byte character's constituent tokens produces exactly
  // that. Never legitimate model output, so it's always safe to drop.
  const text = decode(generatedIds).replace(/�/g, "");
  return { text, tokens: promptIds.length + generatedIds.length };
}

// Mirrors ml/serve/inference_server.py's ENTRY_DRAFT_PATTERN exactly (same
// training format, same parsing rules). Uses [\s\S] instead of the `s`
// (dotAll) flag and plain (not named) groups -- this repo's tsconfig
// targets ES2017, which predates both in TS's regex-literal type checking,
// even though Node itself supports them regardless of compile target.
const ENTRY_DRAFT_PATTERN =
  /course_title:\s*([\s\S]*?)\nsubject_area:\s*([\s\S]*?)\ncredit_value:\s*([\s\S]*?)\nrationale:\s*([\s\S]*)/;

export interface DraftResult {
  subjectArea: string;
  courseTitle: string;
  creditValue: number;
  rationale: string;
}

/** Mirrors inference_server.py's POST /entry-draft handler. Returns null on
 * any parse failure, same as that route's 422 -- callers (slmDraft.ts)
 * already treat null as "fall through to Stage 5", so this needs no
 * separate error channel. */
export function draftEntry(rawWordDump: string): DraftResult | null {
  const { text: completionText } = runAdapter("entry_drafting", `activity: ${rawWordDump}\n`, 120);
  const match = ENTRY_DRAFT_PATTERN.exec(completionText);
  if (!match) return null;
  const [, courseTitle, subjectArea, creditValueRaw, rationale] = match;

  const creditValue = Number(creditValueRaw.trim());
  if (Number.isNaN(creditValue)) return null;

  return {
    subjectArea: subjectArea.trim(),
    courseTitle: courseTitle.trim(),
    creditValue,
    rationale: rationale.trim(),
  };
}

/** Mirrors inference_server.py's POST /chat handler (history accepted by
 * the caller for contract compatibility, not used in the prompt -- see
 * that route and src/lib/benny/chat.ts for why). tokens is surfaced
 * alongside the reply so callers can log it against the account's Benny
 * usage cap (src/lib/billing/tier.ts). */
export function chatReply(message: string): { reply: string; tokens: number } {
  const { text, tokens } = runAdapter("platform_help", `question: ${message}\n`, 200);
  const completionText = text.trim();
  const reply = completionText.toLowerCase().startsWith("answer:")
    ? completionText.slice("answer:".length).trim()
    : completionText;
  return { reply: reply || "I'm not sure how to answer that one yet.", tokens };
}
