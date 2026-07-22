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
 * src/lib/benny/inference/model.ts's chatReply()).
 */

import { isSlmChatEnabled } from "@/lib/flags";
import { chatReply } from "@/lib/benny/inference/model";

const NOT_READY_REPLY = "Benny's still growing and can't chat yet -- check back soon!";
const TROUBLE_REPLY = "Benny's having trouble answering right now -- try again in a bit.";

export type ChatTurn = {
  role: "user" | "assistant";
  body: string;
};

export async function callBennyChat(input: { history: ChatTurn[]; message: string }): Promise<string> {
  if (!isSlmChatEnabled()) return NOT_READY_REPLY;

  try {
    const reply = chatReply(input.message);
    return reply.trim() ? reply : TROUBLE_REPLY;
  } catch (err) {
    console.error("benny chat call failed:", err);
    return TROUBLE_REPLY;
  }
}
