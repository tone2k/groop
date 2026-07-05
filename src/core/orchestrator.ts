import { parseMentions } from './mentions';
import { planRound } from './policy';
import type { AgentConfig, AgentDecision, ChatMessage, Reaction } from './types';

/** Everything an adapter needs to ask a model "what do you do?". */
export interface DecisionContext {
  agent: AgentConfig;
  /** Display names of everyone else in the room, e.g. ["Tony (human)", "GPT (@gpt)"]. */
  otherParticipants: string[];
  /** Full conversation so far, oldest first. */
  transcript: ChatMessage[];
  /** True when the latest activity explicitly @-mentioned this agent. */
  wasMentioned: boolean;
}

export interface ModelClient {
  decide(ctx: DecisionContext): Promise<AgentDecision>;
}

export interface AgentRuntime {
  config: AgentConfig;
  client: ModelClient;
}

export type OrchestratorEvent =
  | { type: 'thinking'; agentId: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'reaction'; messageId: string; reaction: Reaction }
  | { type: 'silent'; agentId: string }
  | { type: 'error'; agentId: string; error: string };

export interface OrchestratorOptions {
  agents: AgentRuntime[];
  /** Max agent rounds per user message (round 0 included). */
  maxRounds?: number;
  now?: () => number;
  newId?: () => string;
}

/**
 * Runs the group-chat protocol for one incoming user message:
 * rounds of sequential polls where each agent tool-calls its decision
 * (message / react / stay silent), with tag-driven follow-up rounds
 * bounded by maxRounds.
 */
export class Orchestrator {
  private agents: AgentRuntime[];
  private maxRounds: number;
  private now: () => number;
  private newId: () => string;

  constructor(opts: OrchestratorOptions) {
    this.agents = opts.agents;
    this.maxRounds = opts.maxRounds ?? 3;
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Handle the user message that was just appended to `transcript`.
   * Appends any agent messages to `transcript` in place and emits events
   * as they happen. Returns the messages created by agents.
   */
  async handleUserMessage(
    transcript: ChatMessage[],
    onEvent: (e: OrchestratorEvent) => void,
  ): Promise<ChatMessage[]> {
    const created: ChatMessage[] = [];
    const agentIds = this.agents.map((a) => a.config.id);
    let triggerMessages = transcript.slice(-1);

    for (let round = 0; round < this.maxRounds; round++) {
      const toPoll = planRound({ agentIds, round, maxRounds: this.maxRounds, triggerMessages });
      if (toPoll.length === 0) break;

      const mentioned = new Set(
        triggerMessages.flatMap((m) => m.mentions.filter((id) => id !== m.authorId)),
      );
      const roundMessages: ChatMessage[] = [];

      for (const agentId of toPoll) {
        const agent = this.agents.find((a) => a.config.id === agentId)!;
        onEvent({ type: 'thinking', agentId });

        let decision: AgentDecision;
        try {
          decision = await agent.client.decide({
            agent: agent.config,
            otherParticipants: this.describeOthers(agentId),
            transcript,
            wasMentioned: mentioned.has(agentId),
          });
        } catch (err) {
          onEvent({ type: 'error', agentId, error: err instanceof Error ? err.message : String(err) });
          continue;
        }

        if (decision.kind === 'message') {
          const message: ChatMessage = {
            id: this.newId(),
            authorId: agentId,
            authorName: agent.config.name,
            text: decision.text,
            images: [],
            mentions: parseMentions(decision.text, agentIds),
            reactions: [],
            createdAt: this.now(),
          };
          transcript.push(message);
          roundMessages.push(message);
          created.push(message);
          onEvent({ type: 'message', message });
        } else if (decision.kind === 'react') {
          const target = [...transcript].reverse().find((m) => m.authorId !== agentId);
          if (target) {
            const reaction: Reaction = { authorId: agentId, authorName: agent.config.name, emoji: decision.emoji };
            target.reactions.push(reaction);
            onEvent({ type: 'reaction', messageId: target.id, reaction });
          }
        } else {
          onEvent({ type: 'silent', agentId });
        }
      }

      triggerMessages = roundMessages;
    }

    return created;
  }

  private describeOthers(selfId: string): string[] {
    return this.agents
      .filter((a) => a.config.id !== selfId)
      .map((a) => `${a.config.name} (@${a.config.id})`);
  }
}
