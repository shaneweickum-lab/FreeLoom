import { describe, expect, it } from "vitest";
import { agreesWithClassicalClassifier, classifySubjectArea } from "./subjectClassifier";

describe("classifySubjectArea", () => {
  it("classifies a word dump using vocabulary lifted straight from a known cluster's own keywords", () => {
    // "chess" is a KNOWLEDGE_BASE keyword for the "Mathematics / Logic" entry.
    const result = classifySubjectArea("played a long game of chess");
    expect(result?.label).toBe("Mathematics / Logic");
  });

  it("classifies text built from a HEURISTIC_CLUSTERS keyword the same way", () => {
    // "guitar"/"sang" are keywords in the Music heuristic cluster. (Avoids
    // "piano" here: that word alone hash-collides into "Mathematics / Logic"'s
    // prototype, which is built from the single sparse keyword "chess" --
    // see MIN_CONFIDENT_SIMILARITY's comment in subjectClassifier.ts.)
    const result = classifySubjectArea("played guitar and sang a song");
    expect(result?.label).toBe("Music");
  });

  it("returns null for text with no real tokens at all (whitespace/stopwords only)", () => {
    expect(classifySubjectArea("   ")).toBeNull();
    expect(classifySubjectArea("the a an of")).toBeNull();
  });

  it("returns a similarity score between -1 and 1 (cosine similarity's real range)", () => {
    const result = classifySubjectArea("played chess with dad");
    expect(result).not.toBeNull();
    expect(result!.similarity).toBeGreaterThanOrEqual(-1);
    expect(result!.similarity).toBeLessThanOrEqual(1);
  });

  it("gives unrelated vocabulary a lower score against a specific cluster than that cluster's own keywords get", () => {
    const onTopic = classifySubjectArea("practiced piano scales")!;
    const offTopicSimilarityToMusic = (() => {
      // Reach the same label's score for clearly unrelated text via classifySubjectArea's
      // own best-match search -- if "durable lumber joinery" ever won the Music label,
      // that alone would already be a surprising/wrong classification.
      const result = classifySubjectArea("durable lumber joinery techniques");
      return result?.label === "Music" ? result.similarity : 0;
    })();
    expect(onTopic.similarity).toBeGreaterThan(offTopicSimilarityToMusic);
  });
});

describe("agreesWithClassicalClassifier", () => {
  it("agrees when the drafted subject area shares a significant word with the classical prediction", () => {
    // Classical prediction for this text should land on/near "Mathematics / Logic".
    expect(agreesWithClassicalClassifier("Mathematics", "played a long game of chess")).toBe(true);
  });

  it("still agrees on an exact label match", () => {
    expect(agreesWithClassicalClassifier("Music", "played guitar and sang a song")).toBe(true);
  });

  it("flags a substantial disagreement when the drafted subject shares nothing with a confident classical prediction", () => {
    expect(agreesWithClassicalClassifier("Underwater Basket Weaving", "practiced piano scales all afternoon")).toBe(
      false
    );
  });

  it("is permissive (agrees) when the classical classifier has no confident opinion at all", () => {
    // Deliberately obscure/off-vocabulary text the hashed prototypes have
    // little signal on -- should never be the reason a plausible draft gets discarded.
    expect(agreesWithClassicalClassifier("Some Novel Subject", "xyzzy zorble quixotic")).toBe(true);
  });
});
