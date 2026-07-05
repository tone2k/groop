import Anthropic from '@anthropic-ai/sdk';
import type { DecisionContext, ModelClient } from '../core/orchestrator';
import type { AgentConfig, AgentDecision } from '../core/types';
import { buildSystemPrompt, DECISION_TOOLS, parseToolDecision, toTurns } from './protocol';

export class AnthropicClient implements ModelClient {
  private client: Anthropic;

  constructor(private config: AgentConfig) {
    this.client = new Anthropic({
      apiKey: process.env[config.apiKeyEnv ?? 'ANTHROPIC_API_KEY'],
      baseURL: config.baseUrl,
    });
  }

  async decide(ctx: DecisionContext): Promise<AgentDecision> {
    const messages: Anthropic.MessageParam[] = toTurns(ctx).map((turn) => {
      if (turn.role === 'self') {
        return { role: 'assistant', content: turn.text };
      }
      const content: Anthropic.ContentBlockParam[] = turn.images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 },
      }));
      content.push({ type: 'text', text: turn.text });
      return { role: 'user', content };
    });

    const res = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 1024,
      system: buildSystemPrompt(ctx),
      tools: DECISION_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: 'object' as const, properties: t.parameters, required: t.required },
      })),
      tool_choice: { type: 'any' },
      messages,
    });

    const tool = res.content.find((b) => b.type === 'tool_use');
    if (tool) return parseToolDecision(tool.name, tool.input as Record<string, unknown>);

    // tool_choice "any" should prevent this, but degrade gracefully.
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text ? { kind: 'message', text } : { kind: 'silent' };
  }
}
