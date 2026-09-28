/**
 * Benny assistant-mode chat backend. Mirrors src/lib/pipeline/slmDraft.ts's
 * feature-flagged, in-process pattern -- inference runs directly inside
 * this app's own Vercel/Node server (src/lib/benny/inference/), no external
 * Mac/tunnel dependency -- with one deliberate difference: callBennyChat()
 * always resolves to a string, never null. slmDraft.ts's Stage 4 has a real
 * fallback (Stage 5 human review) to fall through to on failure; a chat
 * reply has no equivalent "hand it to a person" option, so weights not yet
 * bundled / a generation error all resolve to an honest placeholder reply
 * instead -- the chat UI always has something real to show, never an error
 * state.
 *
 * Also worth restating plainly: Benny is fine-tuned (the `platform_help`
 * adapter, see ml/RESULTS.md) on single-turn, FreeLoom-specific Q&A -- not
 * open-ended conversation. `history` is accepted in the request contract
 * below for future use, but the current adapter has no multi-turn training
 * data, so each reply is generated from `message` alone (see
 * src/lib/benny/inference/model.ts's chatReply()) -- retrieved platform-doc
 * context (platformDocsRetrieval.ts) is composed onto that same single
 * string via chatPrompt.ts's composeChatPrompt(), not modeled as a separate
 * role. This is new plumbing the current (not-yet-retrained) adapter has
 * never seen in its own training data -- the 200M-param redesign
 * (docs/slm-strategy.md) is the point to actually teach it this format;
 * until then it's inert in practice since nothing is served to a real user
 * until hasWeights() is true and a retrained checkpoint backs it.
 */

import { isSlmChatEnabled } from "@/lib/flags";
import { chatReply } from "@/lib/benny/inference/model";
import { composeChatPrompt } from "@/lib/benny/chatPrompt";
import { buildRetrievedContext } from "@/lib/benny/platformDocsRetrieval";

const NOT_READY_REPLY = "Benny's still growing and can't chat yet -- check back soon!";
const TROUBLE_REPLY = "Benny's having trouble answering right now -- try again in a bit.";

export type ChatTurn = {
  role: "user" | "assistant";
  body: string;
};

export type BennyChatResult = { reply: string; tokens: number };

/** tokens is 0 for the placeholder replies below (weights not bundled yet,
 * or a generation error) -- neither one actually ran the model, so nothing
 * should be logged against the account's Benny usage cap for them. */
export async function callBennyChat(input: { history: ChatTurn[]; message: string }): Promise<BennyChatResult> {
  if (!isSlmChatEnabled()) return { reply: NOT_READY_REPLY, tokens: 0 };

  try {
    const prompt = composeChatPrompt(input.message, buildRetrievedContext(input.message));
    const result = chatReply(prompt);
    return result.reply.trim() ? result : { reply: TROUBLE_REPLY, tokens: 0 };
  } catch (err) {
    console.error("benny chat call failed:", err);
    return { reply: TROUBLE_REPLY, tokens: 0 };
  }
}
