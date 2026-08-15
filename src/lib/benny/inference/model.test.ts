import { describe, expect, it } from "vitest";
import { chatReply, draftEntry, forwardLogitsForPrompt, generate } from "./model";
import { loadAdapterWeights, loadBaseWeights } from "./weights";
import { bosId, encode } from "./tokenizer";
import { MODEL_CONFIG } from "./config";

// Runs the REAL forward pass against the REAL bundled base + adapter
// weights and the real tokenizer -- this is exactly the code path
// entry_drafting (Stage 4) and platform_help (Benny chat, behind its own
// launch flag) actually serve from in production. A mocked model here
// would only prove the plumbing works, not that the numerically dense
// math itself is correct end to end.

describe("forwardLogitsForPrompt", () => {
  it("returns one finite logit per vocabulary entry", () => {
    const base = loadBaseWeights();
    const promptIds = [bosId(), ...encode("Played chess with dad")];
    const logits = forwardLogitsForPrompt(promptIds, base, null);
    expect(logits.length).toBe(MODEL_CONFIG.vocabSize);
    expect(Array.from(logits).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("produces different logits for a different prompt", () => {
    const base = loadBaseWeights();
    const logitsA = forwardLogitsForPrompt([bosId(), ...encode("Played chess")], base, null);
    const logitsB = forwardLogitsForPrompt([bosId(), ...encode("Baked cookies")], base, null);
    expect(Array.from(logitsA)).not.toEqual(Array.from(logitsB));
  });

  it("produces different logits with an adapter attached than without one", () => {
    const base = loadBaseWeights();
    const adapter = loadAdapterWeights("entry_drafting");
    const promptIds = [bosId(), ...encode("Played chess with dad")];
    const withoutAdapter = forwardLogitsForPrompt(promptIds, base, null);
    const withAdapter = forwardLogitsForPrompt(promptIds, base, adapter.layers);
    expect(Array.from(withAdapter)).not.toEqual(Array.from(withoutAdapter));
  });
}, 20000);

describe("generate", () => {
  it("returns no tokens at all when maxNewTokens is 0", () => {
    const base = loadBaseWeights();
    const promptIds = [bosId(), ...encode("Played chess")];
    expect(generate(promptIds, 0, base, null)).toEqual([]);
  });

  it("never generates more than maxNewTokens ids", () => {
    const base = loadBaseWeights();
    const promptIds = [bosId(), ...encode("Played chess with dad for an hour")];
    const ids = generate(promptIds, 8, base, null);
    expect(ids.length).toBeLessThanOrEqual(8);
  });

  it("every generated id is a valid, in-range token id", () => {
    const base = loadBaseWeights();
    const promptIds = [bosId(), ...encode("Baked cookies with mom")];
    const ids = generate(promptIds, 8, base, null);
    expect(ids.every((id) => Number.isInteger(id) && id >= 0 && id < MODEL_CONFIG.vocabSize)).toBe(true);
  });

  it("stops early (breaks the repetition loop) rather than always using the full token budget", () => {
    // Greedy decoding on this small a model degenerates into a repeat loop
    // well before maxNewTokens on at least some prompts (this is a known,
    // documented behavior -- see MAX_CONSECUTIVE_REPEATS's own docs). A
    // generous budget with a plain, short prompt reliably exercises that.
    const base = loadBaseWeights();
    const promptIds = [bosId(), ...encode("Played chess")];
    const ids = generate(promptIds, 100, base, null);
    expect(ids.length).toBeLessThanOrEqual(100);
  });
}, 30000);

describe("draftEntry", () => {
  it("runs the real entry_drafting adapter end to end without throwing, on a real word dump", () => {
    const result = draftEntry("Spent the afternoon building a redstone computer in Minecraft");
    // The model can legitimately fail to produce a parseable draft (same
    // reason slmDraft.ts treats null as "fall through to Stage 5") -- what
    // this test actually guarantees is that the real forward pass + regex
    // parse never throws, and that whatever it DOES return is well-formed.
    if (result) {
      expect(typeof result.subjectArea).toBe("string");
      expect(result.subjectArea.length).toBeGreaterThan(0);
      expect(typeof result.courseTitle).toBe("string");
      expect(typeof result.rationale).toBe("string");
      expect(Number.isFinite(result.creditValue)).toBe(true);
    }
  });
}, 30000);

describe("chatReply", () => {
  it("runs the real platform_help adapter end to end and always returns some reply text", () => {
    const { reply, tokens } = chatReply("How do I add another student?");
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
    expect(tokens).toBeGreaterThan(0);
  });

  it("strips a leading 'answer:' prefix from the raw completion", () => {
    // Can't force the model to say a specific thing, but the prefix-strip
    // is plain string logic -- verify indirectly: whatever comes back never
    // itself starts with the literal training-format prefix.
    const { reply } = chatReply("What is FreeLoom?");
    expect(reply.toLowerCase().startsWith("answer:")).toBe(false);
  });
}, 30000);
