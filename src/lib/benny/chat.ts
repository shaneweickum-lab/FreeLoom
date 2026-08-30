/**
 * DORMANT since the Llama 3.2 1B / WebLLM architecture swap -- kept in the
 * repo rather than deleted (see slmDraft.ts's own dormant-marking comment
 * for the same reasoning). No live route calls callBennyChat() anymore;
 * /api/benny/messages/route.ts now only saves the user's message and hands
 * the client everything it needs to generate a reply itself, client-side,
 * via src/lib/benny/webllm/ -- ./reply/route.ts saves what comes back.
 *
 * Everything below describes how this file worked while it was the live
 * chat backend, kept for whenever this project's own model training
 * infrastructure is ready to return to it:
 *
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
 * src/lib/benny/inference/model.ts's chatReply()). Llama 3.2 1B Instruct
 * (the live model now) is a real general-purpose instruction-following
 * model, so the live path actually does use full multi-turn history --
 * see src/lib/benny/webllm/chatPrompt.ts.
 */

import { isSlmChatEnabled } from "@/lib/flags";
import { chatReply } from "@/lib/benny/inference/model";

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
    const result = chatReply(input.message);
    return result.reply.trim() ? result : { reply: TROUBLE_REPLY, tokens: 0 };
  } catch (err) {
    console.error("benny chat call failed:", err);
    return { reply: TROUBLE_REPLY, tokens: 0 };
  }
}
