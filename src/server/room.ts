import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseMentions } from '../core/mentions';
import { Orchestrator, type AgentRuntime, type OrchestratorEvent } from '../core/orchestrator';
import { USER_ID, type ChatMessage, type ImageAttachment } from '../core/types';

export type RoomEvent = OrchestratorEvent;

export interface RoomOptions {
  agents: AgentRuntime[];
  maxRounds?: number;
  /** JSON file to persist the transcript to. Omit for in-memory only. */
  persistPath?: string;
}

/**
 * One group-chat room: the transcript, the orchestrator, an event bus for
 * SSE subscribers, and a queue so overlapping user messages are handled
 * one orchestration at a time.
 */
export class Room {
  readonly agents: AgentRuntime[];
  messages: ChatMessage[] = [];
  busy = false;

  private orchestrator: Orchestrator;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(e: RoomEvent) => void>();
  private persistPath?: string;

  constructor(opts: RoomOptions) {
    this.agents = opts.agents;
    this.persistPath = opts.persistPath;
    this.orchestrator = new Orchestrator({ agents: opts.agents, maxRounds: opts.maxRounds });
    this.load();
  }

  subscribe(fn: (e: RoomEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Append a user message and run the agents. Resolves when the round(s) finish. */
  postUserMessage(input: { text: string; images?: ImageAttachment[]; authorName?: string }): Promise<void> {
    const run = this.queue.then(async () => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        authorId: USER_ID,
        authorName: input.authorName?.trim() || 'You',
        text: input.text,
        images: input.images ?? [],
        mentions: parseMentions(input.text, this.agents.map((a) => a.config.id)),
        reactions: [],
        createdAt: Date.now(),
      };
      this.messages.push(message);
      this.emit({ type: 'message', message });

      this.busy = true;
      try {
        await this.orchestrator.handleUserMessage(this.messages, (e) => {
          this.emit(e);
          if (e.type === 'message' || e.type === 'reaction') this.save();
        });
      } finally {
        this.busy = false;
        this.save();
      }
    });
    // Keep the queue alive even if a run fails.
    this.queue = run.catch(() => {});
    return run;
  }

  reset(): void {
    this.messages.length = 0;
    this.save();
  }

  private emit(e: RoomEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      this.messages = JSON.parse(readFileSync(this.persistPath, 'utf8'));
    } catch {
      this.messages = [];
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(this.messages, null, 2));
  }
}
