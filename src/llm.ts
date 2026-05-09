import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL } from "./config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

interface OpenRouterChatResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export type ChatResult = {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/**
 * Calls an LLM through OpenRouter. Used by sub agent tools that need to generate
 * prose output rather than just look up data. Throws on API error so callers
 * can surface a useful message; callers should wrap in try/catch.
 */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env to enable LLM backed tools.");
  }

  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/kshyatisekhar-panda/component-sourcing-compass",
      "X-Title": "Component Sourcing Compass",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 1500,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as OpenRouterChatResponse;
  const content = data.choices[0]?.message?.content ?? "";
  return { content, usage: data.usage };
}
