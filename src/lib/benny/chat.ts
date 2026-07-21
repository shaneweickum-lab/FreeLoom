/**
 * Benny assistant-mode chat backend. Mirrors src/lib/pipeline/slmDraft.ts's
 * feature-flagged HTTP-call pattern (same MLX/Vercel constraint --
 * ml/README.md's "Mac-only (MLX/Apple Silicon)" column -- so this calls out
 * to SLM_CHAT_URL rather than invoking MLX directly), with one deliberate
 * difference: callBennyChat() always resolves to a string, never null.
 * slmDraft.ts's Stage 4 has a real fallback (Stage 5 human review) to fall
 * through to on failure; a chat reply has no equivalent "hand it to a
 * person" option, so not-configured / network error / timeout / a bad
 * response all resolve to an honest placeholder reply instead -- the chat
 * UI always has something real to show, never an error state.
 *
 * Also worth restating plainly: Benny isn't trained for open-ended
 * conversation yet (ml/README.md -- one narrow entry-drafting adapter, no
 * chat fine-tune, no eval on Q&A). SLM_CHAT_URL is unset everywhere today,
 * so every call here returns the placeholder -- this file exists so the
 * rest of the feature (schema, UI, API route) is real and ready the moment
 * something is actually listening.
 */

import { isSlmChatEnabled } from "@/lib/flags";

const REQUEST_TIMEOUT_MS = 5000;

const NOT_READY_REPLY = "Benny's still growing and can't chat yet -- check back soon!";
const TROUBLE_REPLY = "Benny's having trouble answering right now -- try again in a bit.";

export type ChatTurn = {
  role: "user" | "assistant";
  body: string;
};

/** Request contract (POST {SLM_CHAT_URL}/chat):
 *   { history: {role: "user"|"assistant", body: string}[], message: string }
 * Expected response (whatever's listening should return this shape):
 *   { reply: string }
 */
export async function callBennyChat(input: { history: ChatTurn[]; message: string }): Promise<string> {
  if (!isSlmChatEnabled()) return NOT_READY_REPLY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${process.env.SLM_CHAT_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: input.history, message: input.message }),
      signal: controller.signal,
    });
    if (!res.ok) return TROUBLE_REPLY;

    const data = await res.json();
    return typeof data.reply === "string" && data.reply.trim() ? data.reply : TROUBLE_REPLY;
  } catch (err) {
    console.error("benny chat call failed:", err);
    return TROUBLE_REPLY;
  } finally {
    clearTimeout(timeout);
  }
}
