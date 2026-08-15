import { describe, expect, it } from "vitest";
import { bosId, decode, encode, eosId } from "./tokenizer";

// Deliberately exercises the real committed ml/tokenizer/tokenizer.json via
// the real @huggingface/tokenizers package, not a mock -- the whole point
// of this module is that token ids match exactly what training used, which
// a stubbed tokenizer couldn't verify at all.

describe("tokenizer", () => {
  it("has real, distinct <bos>/<eos> special token ids", () => {
    expect(typeof bosId()).toBe("number");
    expect(typeof eosId()).toBe("number");
    expect(bosId()).not.toBe(eosId());
  });

  it("round-trips plain text through encode -> decode", () => {
    const text = "Played chess with dad for an hour";
    const ids = encode(text);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => Number.isInteger(id) && id >= 0)).toBe(true);
    // BPE round-tripping isn't always byte-identical (casing/whitespace
    // normalization), but the decoded text should closely resemble the input.
    expect(decode(ids).toLowerCase()).toContain("chess");
  });

  it("never includes the <eos> control token's text in decoded output", () => {
    const ids = [...encode("Played chess"), eosId()];
    expect(decode(ids)).not.toMatch(/<eos>/);
  });

  it("produces different token ids for different text", () => {
    expect(encode("Played chess")).not.toEqual(encode("Baked cookies"));
  });
});
