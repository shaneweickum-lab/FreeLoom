import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAssistantContext, buildAssistantSystemPrompt } from "@/lib/assistantContext";
import { ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/assistantTools";
import { getUsageSummary, recordUsage } from "@/lib/usage";
import { generateConversationTitle } from "@/lib/conversationTitle";

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const studentId = typeof body?.student_id === "string" ? body.student_id : "";
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  const userMessage = typeof body?.message === "string" ? body.message.trim() : "";

  if (!studentId || !conversationId || !userMessage) {
    return NextResponse.json({ error: "student_id, conversation_id, and message are required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The assistant needs an ANTHROPIC_API_KEY configured on the server to work." },
      { status: 503 }
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const usageSummary = await getUsageSummary(supabase, user.id);
  if (usageSummary.actionsUsed >= usageSummary.monthlyActions) {
    return NextResponse.json(
      {
        quota_exceeded: true,
        error: `You've used all ${usageSummary.monthlyActions} assistant actions included in your ${usageSummary.plan} plan this month.`,
      },
      { status: 403 }
    );
  }

  // RLS scopes this to the authenticated user's own students; an unowned or
  // missing id resolves to no row, which we treat as not found.
  const { data: student } = await supabase.from("students").select("id, grade_level").eq("id", studentId).maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("id, title")
    .eq("id", conversationId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  const messages: Anthropic.MessageParam[] = (historyRows || []).map((row) => ({
    role: row.role,
    content: row.content,
  }));

  const userBlocks: Anthropic.MessageParam["content"] = [{ type: "text", text: userMessage }];
  messages.push({ role: "user", content: userBlocks });
  await supabase
    .from("chat_messages")
    .insert({ student_id: studentId, conversation_id: conversationId, role: "user", kind: "user", content: userBlocks });

  const context = await buildAssistantContext(supabase, studentId, user.id);
  const systemPrompt = buildAssistantSystemPrompt(context);
  const client = new Anthropic({ apiKey });

  const actionSummaries: string[] = [];
  let finalText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: systemPrompt,
        tools: ASSISTANT_TOOLS,
        messages,
      });
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      messages.push({ role: "assistant", content: response.content });
      await supabase.from("chat_messages").insert({
        student_id: studentId,
        conversation_id: conversationId,
        role: "assistant",
        kind: "assistant",
        content: response.content,
      });

      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      if (textBlocks.length) finalText = textBlocks.map((b) => b.text).join("\n\n");

      if (response.stop_reason !== "tool_use") break;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const { data, summary } = await executeAssistantTool(
          supabase,
          studentId,
          student.grade_level,
          user.id,
          toolUse.name,
          (toolUse.input as Record<string, unknown>) ?? {}
        );
        actionSummaries.push(summary);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(data),
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
      await supabase.from("chat_messages").insert({
        student_id: studentId,
        conversation_id: conversationId,
        role: "user",
        kind: "tool_bridge",
        content: toolResultBlocks,
      });
    }
  } catch (err) {
    console.error("Assistant chat failed", err);
    return NextResponse.json({ error: "The assistant hit an error. Try again." }, { status: 500 });
  }

  await recordUsage(supabase, user.id, "assistant_chat", totalInputTokens, totalOutputTokens);

  // Only (re)title on the first exchange, or if this conversation still carries the
  // pre-threading backfill placeholder — title generation itself doesn't count as a
  // billed action, it's app overhead, not something the user asked for.
  const conversationUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!conversation.title || conversation.title === "Earlier conversation") {
    conversationUpdate.title = await generateConversationTitle(`Parent: ${userMessage}\nAssistant: ${finalText}`);
  }
  await supabase.from("chat_conversations").update(conversationUpdate).eq("id", conversationId);

  return NextResponse.json({ reply: finalText, actions: actionSummaries });
}
