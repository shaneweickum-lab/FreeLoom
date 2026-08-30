/**
 * Runs Benny assistant-mode chat generation client-side, via the WebLLM
 * "chat" engine instance -- called from BennyChat.tsx between the two
 * server calls (POST /api/benny/messages saves the user's message and
 * hands back the message list; this generates a reply; POST
 * /api/benny/messages/reply saves it).
 *
 * Always resolves to a real reply string, never null/throws -- same
 * philosophy the old (now dormant) src/lib/benny/chat.ts's callBennyChat()
 * had: a chat reply has no equivalent "hand it to a person" fallback the
 * way Stage 4 drafting does, so an unavailable engine or a generation
 * error both resolve to an honest, specific placeholder reply instead of
 * an error state the caller has to special-case.
 */

import type { InitProgressCallback } from "@mlc-ai/web-llm";
import { getBennyEngine } from "@/lib/benny/webllm/engine";
import { chatTierFor } from "@/lib/benny/webllm/capabilities";
import { buildBennySystemPrompt } from "@/lib/benny/webllm/chatPrompt";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const UNAVAILABLE_REPLY =
  "Benny's AI features need a browser/device with WebGPU support, and this one doesn't have it -- try again from a different device.";
const TROUBLE_REPLY = "Benny's having trouble answering right now -- try again in a bit.";

export async function generateBennyReply(
  messages: ChatMessage[],
  options: { isMobile: boolean; onProgress?: InitProgressCallback; extraContext?: string }
): Promise<string> {
  const tier = chatTierFor(options.isMobile);
  const result = await getBennyEngine("chat", tier, options.onProgress);
  if (!result.engine) return UNAVAILABLE_REPLY;

  try {
    const completion = await result.engine.chat.completions.create({
      messages: [{ role: "system", content: buildBennySystemPrompt(options.extraContext) }, ...messages],
    });
    const reply = completion.choices[0]?.message?.content?.trim();
    return reply || TROUBLE_REPLY;
  } catch (err) {
    console.error("Benny chat generation failed:", err);
    return TROUBLE_REPLY;
  }
}
