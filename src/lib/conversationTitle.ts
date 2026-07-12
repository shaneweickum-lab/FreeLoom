import Anthropic from "@anthropic-ai/sdk";

const EMIT_TITLE_TOOL: Anthropic.Tool = {
  name: "emit_title",
  description: "Emit a short title summarizing a conversation.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A 3-6 word title capturing what the conversation is about. No quotes, no trailing punctuation.",
      },
    },
    required: ["title"],
  },
};

function fallbackTitle(excerpt: string): string {
  const trimmed = excerpt.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 60) : "New conversation";
}

export async function generateConversationTitle(excerpt: string): Promise<string> {
  const fallback = fallbackTitle(excerpt);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !excerpt.trim()) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 60,
      tools: [EMIT_TITLE_TOOL],
      tool_choice: { type: "tool", name: "emit_title" },
      messages: [
        {
          role: "user",
          content: `Give this conversation excerpt a short title (3-6 words, no quotes, no trailing period):\n\n${excerpt.slice(
            0,
            2000
          )}`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use") as
      | { type: "tool_use"; input: unknown }
      | undefined;
    const parsed = toolUse?.input as { title?: string } | undefined;
    const title = parsed?.title?.trim();
    return title ? title.slice(0, 80) : fallback;
  } catch (err) {
    console.error("Conversation title generation failed, falling back to excerpt", err);
    return fallback;
  }
}
