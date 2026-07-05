import { describe, expect, it } from 'vitest';
import { planRound } from './policy';
import type { ChatMessage } from './types';

const agentIds = ['claude', 'gpt', 'gemini'];

function msg(authorId: string, text: string, mentions: string[] = []): ChatMessage {
  return {
    id: `m-${Math.random()}`,
    authorId,
    authorName: authorId,
    text,
    images: [],
    mentions,
    reactions: [],
    createdAt: 0,
  };
}

describe('planRound', () => {
  it('round 0: polls every agent except the author, in config order', () => {
    const plan = planRound({
      agentIds,
      round: 0,
      maxRounds: 2,
      triggerMessages: [msg('user', 'hello everyone')],
    });
    expect(plan).toEqual(['claude', 'gpt', 'gemini']);
  });

  it('round 0: mentioned agents are polled first, in mention order', () => {
    const plan = planRound({
      agentIds,
      round: 0,
      maxRounds: 2,
      triggerMessages: [msg('user', '@gemini @gpt thoughts?', ['gemini', 'gpt'])],
    });
    expect(plan).toEqual(['gemini', 'gpt', 'claude']);
  });

  it('round 0: an agent is never polled about its own message', () => {
    const plan = planRound({
      agentIds,
      round: 0,
      maxRounds: 2,
      triggerMessages: [msg('claude', 'here is my take')],
    });
    expect(plan).toEqual(['gpt', 'gemini']);
  });

  it('later rounds: only agents mentioned by the previous round are polled', () => {
    const plan = planRound({
      agentIds,
      round: 1,
      maxRounds: 3,
      triggerMessages: [msg('claude', '@gpt can you check my math?', ['gpt'])],
    });
    expect(plan).toEqual(['gpt']);
  });

  it('later rounds: self-mentions do not cause a self-poll', () => {
    const plan = planRound({
      agentIds,
      round: 1,
      maxRounds: 3,
      triggerMessages: [msg('gpt', 'as @gpt I already said this, but @claude?', ['gpt', 'claude'])],
    });
    expect(plan).toEqual(['claude']);
  });

  it('returns nothing once the round cap is reached, even with mentions', () => {
    const plan = planRound({
      agentIds,
      round: 2,
      maxRounds: 2,
      triggerMessages: [msg('claude', '@gpt keep going', ['gpt'])],
    });
    expect(plan).toEqual([]);
  });

  it('dedupes agents mentioned by multiple messages in the same round', () => {
    const plan = planRound({
      agentIds,
      round: 1,
      maxRounds: 3,
      triggerMessages: [
        msg('claude', '@gemini?', ['gemini']),
        msg('gpt', 'yes @gemini should decide', ['gemini']),
      ],
    });
    expect(plan).toEqual(['gemini']);
  });

  it('ignores mentions of ids that are not configured agents', () => {
    const plan = planRound({
      agentIds,
      round: 1,
      maxRounds: 3,
      triggerMessages: [msg('claude', 'ping @user @someone', ['user', 'someone'])],
    });
    expect(plan).toEqual([]);
  });
});
