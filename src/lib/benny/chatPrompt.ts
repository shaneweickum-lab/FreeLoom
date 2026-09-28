/**
 * Composes what actually gets fed to the platform_help adapter
 * (src/lib/benny/chat.ts's callBennyChat -> inference/model.ts's
 * chatReply()). That adapter takes a single input string, not a
 * system/user role split -- it was fine-tuned on single-turn Q&A pairs,
 * no system-prompt or multi-turn convention in its training data (see
 * ml/README.md's platform_help entry) -- so retrieved documentation
 * context (platformDocsRetrieval.ts's buildRetrievedContext()) is
 * prepended directly onto the question text here rather than modeled as
 * a separate role the way a general-purpose instruction model would
 * expect.
 *
 * The next retrain (the 200M-param redesign, docs/slm-strategy.md) is
 * the point to actually teach the model this RAG-context convention as
 * part of its training data, rather than hoping an untrained format
 * generalizes -- until then this is genuinely new plumbing riding on an
 * adapter that's never seen it, which is fine precisely because nothing
 * is served to a real user until hasWeights() is true and a retrained
 * checkpoint backs it (see chat.ts).
 */

export function composeChatPrompt(message: string, extraContext?: string): string {
  if (!extraContext) return message;
  return `Relevant FreeLoom documentation:\n${extraContext}\n\nQuestion: ${message}`;
}
