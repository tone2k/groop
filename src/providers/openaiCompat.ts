import OpenAI from 'openai';
import type { DecisionContext, ModelClient } from '../core/orchestrator';
import type { AgentConfig, AgentDecision } from '../core/types';
import { buildSystemPrompt, DECISION_TOOLS, parseToolDecision, toTurns } from './protocol';

/**
 * Adapter for any OpenAI-compatible chat-completions endpoint:
 * OpenAI itself, Ollama (http://localhost:11434/v1), Groq, xAI,
 * Mistral, Gemini's compat endpoint, etc.
 */
export class OpenAICompatClient implements ModelClient {
  private client: OpenAI;

  constructor(private config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: process.env[config.apiKeyEnv ?? 'OPENAI_API_KEY'] ?? 'not-needed',
      baseURL: config.baseUrl,
    });
  }

  async decide(ctx: DecisionContext): Promise<AgentDecision> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      ...toTurns(ctx).map((turn): OpenAI.ChatCompletionMessageParam => {
        if (turn.role === 'self') return { role: 'assistant', content: turn.text };
        const parts: OpenAI.ChatCompletionContentPart[] = [{ type: 'text', text: turn.text }];
        for (const img of turn.images) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` },
          });
        }
        return { role: 'user', content: parts };
      }),
    ];

    const tools: OpenAI.ChatCompletionTool[] = DECISION_TOOLS.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: 'object', properties: t.parameters, required: t.required },
      },
    }));

    let res: OpenAI.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        tools,
        tool_choice: 'required',
      });
    } catch {
      // Some compat servers (notably older Ollama builds) reject
      // tool_choice: "required"; retry letting the model pick.
      res = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        tools,
        tool_choice: 'auto',
      });
    }

    const choice = res.choices[0];
    const call = choice?.message.tool_calls?.[0];
    if (call && call.type === 'function') {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // malformed arguments -> treated as silence by parseToolDecision
      }
      return parseToolDecision(call.function.name, args);
    }

    const text = choice?.message.content?.trim();
    return text ? { kind: 'message', text } : { kind: 'silent' };
  }
}
