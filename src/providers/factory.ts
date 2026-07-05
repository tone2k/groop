import type { ModelClient } from '../core/orchestrator';
import type { AgentConfig } from '../core/types';
import { AnthropicClient } from './anthropic';
import { OpenAICompatClient } from './openaiCompat';

export function createModelClient(config: AgentConfig): ModelClient {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicClient(config);
    case 'openai-compatible':
      return new OpenAICompatClient(config);
  }
}
