import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBennyChat, type ChatTurn } from "@/lib/benny/chat";
import { BENNY_ASSISTANT_MODE_LAUNCHED, getBennyUsageWindow, isBennyAvailable } from "@/lib/billing/tier";

const DEFAULT_TITLE = "New conversation";
const TITLE_MAX_LEN = 50;

function formatResetDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

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

  // Checked before touching the conversation at all -- a plan/cap block
  // shouldn't leave a half-created exchange (a saved user message with no
  // reply) sitting in the thread.
  const [{ data: profile }, { data: adminRow }] = await Promise.all([
    supabase
      .from("school_profiles")
      .select("subscription_tier, subscription_status, grandfathered_until, current_period_end, benny_trial_ends_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  // Checked before the tier/trial gate below -- this is a hard kill-switch
  // independent of plan, not a billing limit, so it gets its own distinct
  // response rather than reusing the "upgrade your plan" message.
  if (!BENNY_ASSISTANT_MODE_LAUNCHED) {
    return NextResponse.json({ error: "Benny isn't available yet." }, { status: 403 });
  }
  const tierProfile = {
    subscription_tier: profile?.subscription_tier ?? "free",
    subscription_status: profile?.subscription_status ?? null,
    grandfathered_until: profile?.grandfathered_until ?? null,
    current_period_end: profile?.current_period_end ?? null,
    benny_trial_ends_at: profile?.benny_trial_ends_at ?? null,
    isAdmin: !!adminRow,
  };
  if (!isBennyAvailable(tierProfile)) {
    return NextResponse.json(
      { error: "Benny isn't available on your plan. Upgrade to Pro or Premium to start chatting." },
      { status: 403 }
    );
  }

  const usageWindow = getBennyUsageWindow(tierProfile);
  if (usageWindow.cap !== null) {
    const { data: usageRows } = await supabase
      .from("benny_token_usage")
      .select("tokens")
      .eq("user_id", user.id)
      .gte("created_at", usageWindow.periodStart.toISOString());
    const used = (usageRows ?? []).reduce((sum, row) => sum + row.tokens, 0);
    if (used >= usageWindow.cap) {
      const message =
        usageWindow.source === "trial"
          ? "You've used up your Benny trial messages. Upgrade to Pro or Premium for ongoing access."
          : `You've used all your Benny messages for this month. More become available on ${formatResetDate(
              usageWindow.resetsAt as Date
            )}, or upgrade to Premium for unlimited access.`;
      return NextResponse.json({ error: message }, { status: 429 });
    }
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

  const { reply, tokens } = await callBennyChat({
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

  // tokens is 0 for a placeholder reply (weights not bundled / generation
  // error, see callBennyChat) -- nothing real ran, so nothing to log.
  if (tokens > 0) {
    const { error: usageInsertError } = await supabase.from("benny_token_usage").insert({ user_id: user.id, tokens });
    if (usageInsertError) console.error("benny token usage insert error:", usageInsertError);
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
