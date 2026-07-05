/** An image attached to a chat message, stored as base64. */
export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  dataBase64: string;
}

export interface Reaction {
  authorId: string;
  authorName: string;
  emoji: string;
}

export interface ChatMessage {
  id: string;
  /** 'user' for the human, otherwise the agent's id (its @handle). */
  authorId: string;
  authorName: string;
  text: string;
  images: ImageAttachment[];
  /** Agent ids @-mentioned in the text. */
  mentions: string[];
  reactions: Reaction[];
  createdAt: number;
}

export type ProviderKind = 'anthropic' | 'openai-compatible';

export interface AgentConfig {
  /** The agent's @handle, e.g. "claude". Lowercase, no spaces. */
  id: string;
  /** Display name, e.g. "Claude". */
  name: string;
  provider: ProviderKind;
  /** Provider model id, e.g. "claude-sonnet-5" or "llama3.2". */
  model: string;
  /** Override for OpenAI-compatible endpoints (Ollama, Groq, ...). */
  baseUrl?: string;
  /** Env var holding the API key, e.g. "OPENAI_API_KEY". */
  apiKeyEnv?: string;
  /** Optional persona appended to the system prompt. */
  persona?: string;
}

/** What an agent chose to do about the latest state of the chat. */
export type AgentDecision =
  | { kind: 'message'; text: string }
  | { kind: 'react'; emoji: string }
  | { kind: 'silent' };

export const USER_ID = 'user';
