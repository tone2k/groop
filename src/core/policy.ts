import type { ChatMessage } from './types';

export interface RoundPlanInput {
  /** Configured agent ids, in config order. */
  agentIds: string[];
  /** 0 = the round triggered directly by a user message. */
  round: number;
  /** Total number of agent rounds allowed per user message. */
  maxRounds: number;
  /** Messages created in the previous round (or the user message for round 0). */
  triggerMessages: ChatMessage[];
}

/**
 * Decide which agents get a chance to act this round, in polling order.
 *
 * Round 0 (a user just spoke): everyone except the author is polled;
 * mentioned agents go first so the person being asked answers before
 * bystanders decide whether to chime in.
 *
 * Rounds > 0 (agents reacting to agents): only agents explicitly mentioned
 * by the previous round are polled — this is what keeps a topic from
 * dragging on forever — and the cap on rounds bounds tag chains.
 */
export function planRound(input: RoundPlanInput): string[] {
  const { agentIds, round, maxRounds, triggerMessages } = input;
  if (round >= maxRounds) return [];

  const isAgent = (id: string) => agentIds.includes(id);
  const plan: string[] = [];
  const add = (id: string) => {
    if (isAgent(id) && !plan.includes(id)) plan.push(id);
  };

  // Agents mentioned by the trigger messages, skipping self-mentions.
  for (const m of triggerMessages) {
    for (const mention of m.mentions) {
      if (mention !== m.authorId) add(mention);
    }
  }

  if (round === 0) {
    const authors = new Set(triggerMessages.map((m) => m.authorId));
    for (const id of agentIds) {
      if (!authors.has(id)) add(id);
    }
    return plan.filter((id) => !authors.has(id));
  }

  return plan;
}
