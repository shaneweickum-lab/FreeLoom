import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/rateLimit";

/** Rough chars-per-token approximation for English text -- there's no
 * tokenizer running server-side to count exactly (the model and its real
 * tokenizer only exist in the browser now), and this is only used for the
 * account's own usage-cap counter, not anything that needs to be precise.
 * Deliberately NOT trusting a client-reported token count: a client could
 * report anything, but it can't lie about the length of the text it's
 * asking to have saved into its own chat history. */
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

/**
 * Saves the reply BennyChat.tsx generated client-side (via WebLLM) and
 * logs its estimated token usage -- the second half of the send/reply
 * split described in ../route.ts's own doc comment. No model call
 * happens here; this is pure persistence + bookkeeping, same trust
 * boundary as any other client-submitted content (RLS-equivalent
 * ownership check, not taken at face value).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (isRateLimited(`benny-messages:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many messages -- try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const replyBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!conversationId || !replyBody) {
    return NextResponse.json({ error: "conversationId and body are required" }, { status: 400 });
  }

  const { data: conversation, error: convError } = await supabase
    .from("benny_conversations")
    .select("id, user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convError || !conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data: assistantMessage, error: assistantInsertError } = await supabase
    .from("benny_messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", body: replyBody })
    .select("*")
    .single();
  if (assistantInsertError || !assistantMessage) {
    console.error("benny assistant message insert error:", assistantInsertError);
    return NextResponse.json({ error: "Couldn't save that reply." }, { status: 500 });
  }

  const { error: usageInsertError } = await supabase
    .from("benny_token_usage")
    .insert({ user_id: user.id, tokens: estimateTokens(replyBody) });
  if (usageInsertError) console.error("benny token usage insert error:", usageInsertError);

  const { error: updateError } = await supabase
    .from("benny_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (updateError) console.error("benny conversation update error:", updateError);

  return NextResponse.json({ assistantMessage });
}
