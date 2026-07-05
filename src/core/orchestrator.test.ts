import { describe, expect, it } from 'vitest';
import { Orchestrator, type DecisionContext, type ModelClient, type OrchestratorEvent } from './orchestrator';
import type { AgentConfig, AgentDecision, ChatMessage } from './types';

function agentConfig(id: string): AgentConfig {
  return { id, name: id.toUpperCase(), provider: 'anthropic', model: 'test-model' };
}

/** A fake model that replays scripted decisions and records every context it saw. */
function scripted(...decisions: AgentDecision[]): ModelClient & { calls: DecisionContext[] } {
  const calls: DecisionContext[] = [];
  return {
    calls,
    async decide(ctx) {
      calls.push(structuredClone(ctx));
      return decisions[Math.min(calls.length, decisions.length) - 1] ?? { kind: 'silent' };
    },
  };
}

function userMsg(text: string, mentions: string[] = []): ChatMessage {
  return {
    id: 'u1',
    authorId: 'user',
    authorName: 'Tony',
    text,
    images: [],
    mentions,
    reactions: [],
    createdAt: 1,
  };
}

async function run(orch: Orchestrator, transcript: ChatMessage[]) {
  const events: OrchestratorEvent[] = [];
  await orch.handleUserMessage(transcript, (e) => events.push(e));
  return events;
}

describe('Orchestrator', () => {
  it('polls agents sequentially so later agents see earlier replies', async () => {
    const claude = scripted({ kind: 'message', text: 'The answer is 42.' });
    const gpt = scripted({ kind: 'silent' });
    const orch = new Orchestrator({
      agents: [
        { config: agentConfig('claude'), client: claude },
        { config: agentConfig('gpt'), client: gpt },
      ],
    });

    const transcript: ChatMessage[] = [userMsg('what is 6*7?')];
    const events = await run(orch, transcript);

    // claude replied, and gpt's context already contained claude's reply
    expect(gpt.calls).toHaveLength(1);
    const gptSaw = gpt.calls[0]!.transcript.map((m) => m.authorId);
    expect(gptSaw).toEqual(['user', 'claude']);

    // transcript got the new message appended
    expect(transcript.map((m) => m.authorId)).toEqual(['user', 'claude']);
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'silent')).toEqual([
      expect.objectContaining({ agentId: 'gpt' }),
    ]);
  });

  it('reactions attach to the message that triggered the poll', async () => {
    const claude = scripted({ kind: 'react', emoji: '👍' });
    const orch = new Orchestrator({ agents: [{ config: agentConfig('claude'), client: claude }] });

    const transcript = [userMsg('shipped the fix!')];
    const events = await run(orch, transcript);

    expect(transcript[0]!.reactions).toEqual([
      { authorId: 'claude', authorName: 'CLAUDE', emoji: '👍' },
    ]);
    expect(events).toContainEqual({
      type: 'reaction',
      messageId: 'u1',
      reaction: { authorId: 'claude', authorName: 'CLAUDE', emoji: '👍' },
    });
  });

  it('tells an agent when it was mentioned', async () => {
    const claude = scripted({ kind: 'silent' });
    const gpt = scripted({ kind: 'silent' });
    const orch = new Orchestrator({
      agents: [
        { config: agentConfig('claude'), client: claude },
        { config: agentConfig('gpt'), client: gpt },
      ],
    });

    await run(orch, [userMsg('@gpt your turn', ['gpt'])]);

    expect(gpt.calls[0]!.wasMentioned).toBe(true);
    expect(claude.calls[0]!.wasMentioned).toBe(false);
  });

  it('an agent reply that tags another agent triggers a bounded follow-up round', async () => {
    // claude tags gpt; gpt replies tagging claude; claude would tag gpt again forever.
    const claude = scripted(
      { kind: 'message', text: 'I think X — @gpt do you agree?' },
      { kind: 'message', text: 'fair point @gpt, still X.' },
    );
    const gpt = scripted(
      { kind: 'silent' },
      { kind: 'message', text: 'Mostly, @claude, but consider Y.' },
    );
    const orch = new Orchestrator({
      agents: [
        { config: agentConfig('claude'), client: claude },
        { config: agentConfig('gpt'), client: gpt },
      ],
      maxRounds: 3,
    });

    const transcript = [userMsg('hard question')];
    await run(orch, transcript);

    // round 0: claude msg (tags gpt), gpt silent
    // round 1: gpt polled (was tagged), replies tagging claude
    // round 2: claude polled, replies tagging gpt
    // round 3: capped — gpt never polled again
    expect(transcript.map((m) => m.authorId)).toEqual(['user', 'claude', 'gpt', 'claude']);
    expect(gpt.calls).toHaveLength(2);
    expect(claude.calls).toHaveLength(2);
    // the follow-up polls know they were mentioned
    expect(gpt.calls[1]!.wasMentioned).toBe(true);
  });

  it('mentions in agent replies are parsed against known agent ids', async () => {
    const claude = scripted({ kind: 'message', text: 'ask @gpt or @stranger' });
    const gpt = scripted({ kind: 'silent' }, { kind: 'silent' });
    const orch = new Orchestrator({
      agents: [
        { config: agentConfig('claude'), client: claude },
        { config: agentConfig('gpt'), client: gpt },
      ],
    });

    const transcript = [userMsg('hi')];
    await run(orch, transcript);
    expect(transcript[1]!.mentions).toEqual(['gpt']);
  });

  it('one agent erroring does not block the others', async () => {
    const broken: ModelClient = {
      async decide() {
        throw new Error('rate limited');
      },
    };
    const gpt = scripted({ kind: 'message', text: 'still here' });
    const orch = new Orchestrator({
      agents: [
        { config: agentConfig('claude'), client: broken },
        { config: agentConfig('gpt'), client: gpt },
      ],
    });

    const transcript = [userMsg('hello?')];
    const events = await run(orch, transcript);

    expect(transcript.map((m) => m.authorId)).toEqual(['user', 'gpt']);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', agentId: 'claude' }),
    );
  });
});
