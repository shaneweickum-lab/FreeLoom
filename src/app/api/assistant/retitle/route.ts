import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateConversationTitle } from "@/lib/conversationTitle";

type TextBlock = { type: "text"; text: string };

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as { type?: string }).type === "text";
}

const PLACEHOLDER_TITLE = "Earlier conversation";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS scopes this to the authenticated user's own conversations.
  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("id, title")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.title && conversation.title !== PLACEHOLDER_TITLE) {
    return NextResponse.json({ title: conversation.title });
  }

  const { data: rows } = await supabase
    .from("chat_messages")
    .select("kind, content")
    .eq("conversation_id", conversationId)
    .in("kind", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(6);

  const excerpt = (rows || [])
    .map((row) => {
      const blocks = (row.content as unknown[]) || [];
      const text = blocks
        .filter(isTextBlock)
        .map((b) => b.text)
        .join(" ")
        .trim();
      if (!text) return null;
      return `${row.kind === "user" ? "Parent" : "Assistant"}: ${text}`;
    })
    .filter((line): line is string => !!line)
    .join("\n");

  if (!excerpt) {
    return NextResponse.json({ title: conversation.title ?? null });
  }

  const title = await generateConversationTitle(excerpt);
  await supabase.from("chat_conversations").update({ title }).eq("id", conversationId);
  return NextResponse.json({ title });
}
