import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBennyChat, type ChatTurn } from "@/lib/benny/chat";

const DEFAULT_TITLE = "New conversation";
const TITLE_MAX_LEN = 50;

// Conversation create/list/delete are plain client-side Supabase calls under
// RLS (see BennyConversations.tsx), same as how MessageThreads.tsx handles
// support_threads directly -- this route only covers the one step that
// needs a server-only env var (SLM_CHAT_URL): sending a message and getting
// Benny's reply.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const messageBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!conversationId || !messageBody) {
    return NextResponse.json({ error: "conversationId and body are required" }, { status: 400 });
  }

  // RLS already scopes this to the caller's own conversations; checked
  // explicitly too rather than trusting any client input, same convention
  // as /api/messages's thread-ownership check.
  const { data: conversation, error: convError } = await supabase
    .from("benny_conversations")
    .select("id, user_id, title")
    .eq("id", conversationId)
    .maybeSingle();
  if (convError || !conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data: history } = await supabase
    .from("benny_messages")
    .select("role, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const { data: userMessage, error: userInsertError } = await supabase
    .from("benny_messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "user", body: messageBody })
    .select("*")
    .single();
  if (userInsertError || !userMessage) {
    console.error("benny user message insert error:", userInsertError);
    return NextResponse.json({ error: "Couldn't save that message." }, { status: 500 });
  }

  const reply = await callBennyChat({
    history: (history ?? []) as ChatTurn[],
    message: messageBody,
  });

  const { data: assistantMessage, error: assistantInsertError } = await supabase
    .from("benny_messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", body: reply })
    .select("*")
    .single();
  if (assistantInsertError || !assistantMessage) {
    console.error("benny assistant message insert error:", assistantInsertError);
    return NextResponse.json({ error: "Couldn't get a reply." }, { status: 500 });
  }

  // Title is auto-derived from the first message and never changed again --
  // only bump it while it's still the default.
  const updates: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
  if (conversation.title === DEFAULT_TITLE) {
    updates.title = messageBody.slice(0, TITLE_MAX_LEN);
  }
  const { error: updateError } = await supabase.from("benny_conversations").update(updates).eq("id", conversationId);
  if (updateError) console.error("benny conversation update error:", updateError);

  return NextResponse.json({ userMessage, assistantMessage });
}
