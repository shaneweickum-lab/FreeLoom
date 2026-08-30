/**
 * Benny assistant-mode chat's system prompt. Unlike the old (now dormant)
 * platform_help LoRA adapter -- fine-tuned on single-turn, FreeLoom-
 * specific Q&A, with no multi-turn training data at all (see
 * src/lib/benny/chat.ts) -- Llama 3.2 1B Instruct is a real general-
 * purpose instruction-following model, so a genuine multi-turn
 * conversation is actually a fair thing to offer now, not a
 * misrepresentation of what the model can do.
 *
 * `extraContext` is Batch 5's hook: retrieved platform-documentation
 * excerpts get appended here so chat answers about how FreeLoom actually
 * works are grounded in real docs instead of the model guessing --
 * nothing calls this with extraContext set yet.
 */

const BASE_SYSTEM_PROMPT = `You are Benny, the AI assistant built into FreeLoom, a credit-tracking platform for homeschooling, unschooling, and other alternative-education families. You help parents understand how to use FreeLoom (logging activities, transcripts, portfolios, credits, settings) and answer general questions about their approach to their child's education.

Be warm, concise, and honest. If you don't actually know something specific about how FreeLoom works, say so plainly rather than guessing -- a wrong answer about a real feature is worse than admitting uncertainty. You are not a substitute for professional educational, legal, or medical advice, and should say so if a question calls for it.`;

export function buildBennySystemPrompt(extraContext?: string): string {
  if (!extraContext) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\nRelevant FreeLoom documentation for this question:\n${extraContext}`;
}
