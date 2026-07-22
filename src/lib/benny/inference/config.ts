/**
 * Mirrors ml/model/config.py's ModelConfig/BASE_CONFIG and LORA_RANK/
 * LORA_ALPHA exactly -- these two files must stay in sync (same reasoning
 * as train_base.py's own vocab_size/tokenizer assertion: a mismatch here
 * means this runtime's math silently diverges from what was actually
 * trained).
 */

export const MODEL_CONFIG = {
  vocabSize: 8000,
  dModel: 384,
  nLayers: 6,
  nHeads: 6,
  mlpRatio: 4,
  maxSeqLen: 512,
} as const;

export const HEAD_DIM = MODEL_CONFIG.dModel / MODEL_CONFIG.nHeads;
export const MLP_DIM = MODEL_CONFIG.dModel * MODEL_CONFIG.mlpRatio;

export const LORA_RANK = 8;
export const LORA_ALPHA = 16;
export const LORA_SCALE = LORA_ALPHA / LORA_RANK;

export const LAYER_NORM_EPS = 1e-5;
