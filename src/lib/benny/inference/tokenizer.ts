/**
 * Loads ml/tokenizer/tokenizer.json (already committed, no export step
 * needed) via @huggingface/tokenizers -- a pure-JS, zero-dependency
 * tokenizer runtime chosen specifically to avoid the native-binary/
 * platform-compatibility risk of HuggingFace's other `tokenizers` npm
 * package (whose prebuilt binaries turned out not to be published for the
 * versions that matter here). Same BPE vocab/merges as training time, so
 * token ids match exactly.
 */

import fs from "node:fs";
import path from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";

const TOKENIZER_PATH = path.join(process.cwd(), "ml", "tokenizer", "tokenizer.json");

let cachedTokenizer: Tokenizer | null = null;
let cachedBosId: number | null = null;
let cachedEosId: number | null = null;

function getTokenizer(): Tokenizer {
  if (!cachedTokenizer) {
    const tokenizerJson = JSON.parse(fs.readFileSync(TOKENIZER_PATH, "utf-8"));
    cachedTokenizer = new Tokenizer(tokenizerJson, {});
    const bos = cachedTokenizer.token_to_id("<bos>");
    const eos = cachedTokenizer.token_to_id("<eos>");
    if (bos === undefined || eos === undefined) {
      throw new Error("tokenizer.json is missing the <bos>/<eos> special tokens this model was trained with");
    }
    cachedBosId = bos;
    cachedEosId = eos;
  }
  return cachedTokenizer;
}

export function encode(text: string): number[] {
  return getTokenizer().encode(text).ids;
}

export function decode(ids: number[]): string {
  return getTokenizer().decode(ids);
}

export function bosId(): number {
  getTokenizer();
  return cachedBosId as number;
}

export function eosId(): number {
  getTokenizer();
  return cachedEosId as number;
}
