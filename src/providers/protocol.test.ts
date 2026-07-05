import { describe, expect, it } from 'vitest';
import type { DecisionContext } from '../core/orchestrator';
import type { AgentConfig, ChatMessage } from '../core/types';
import { buildSystemPrompt, parseToolDecision, toTurns } from './protocol';

const claude: AgentConfig = { id: 'claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5' };

function msg(authorId: string, authorName: string, text: string, images: ChatMessage['images'] = []): ChatMessage {
  return { id: `m-${text}`, authorId, authorName, text, images, mentions: [], reactions: [], createdAt: 0 };
}

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    agent: claude,
    otherParticipants: ['GPT (@gpt)'],
    transcript: [msg('user', 'Tony', 'hello')],
    wasMentioned: false,
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('names the agent, its handle, and the other participants', () => {
    const prompt = buildSystemPrompt(ctx());
    expect(prompt).toContain('Claude');
    expect(prompt).toContain('@claude');
    expect(prompt).toContain('GPT (@gpt)');
  });

  it('states the restraint norm: staying silent is normal', () => {
    expect(buildSystemPrompt(ctx())).toMatch(/stay_silent/);
  });

  it('tells a mentioned agent it is expected to reply', () => {
    const mentioned = buildSystemPrompt(ctx({ wasMentioned: true }));
    const not = buildSystemPrompt(ctx({ wasMentioned: false }));
    expect(mentioned).toContain('You were mentioned');
    expect(not).not.toContain('You were mentioned');
  });

  it('appends the persona when configured', () => {
    const prompt = buildSystemPrompt(ctx({ agent: { ...claude, persona: 'You are the skeptic of the group.' } }));
    expect(prompt).toContain('You are the skeptic of the group.');
  });
});

describe('toTurns', () => {
  it("marks the agent's own messages as self and prefixes everyone else's with their name", () => {
    const turns = toTurns(
      ctx({
        transcript: [
          msg('user', 'Tony', 'what is 6*7?'),
          msg('claude', 'Claude', 'The answer is 42.'),
          msg('gpt', 'GPT', 'agreed'),
        ],
      }),
    );
    expect(turns).toEqual([
      { role: 'other', text: '[Tony]: what is 6*7?', images: [] },
      { role: 'self', text: 'The answer is 42.', images: [] },
      { role: 'other', text: '[GPT]: agreed', images: [] },
    ]);
  });

  it('coalesces consecutive other-author messages into one turn', () => {
    const turns = toTurns(
      ctx({
        transcript: [
          msg('user', 'Tony', 'hi all'),
          msg('gpt', 'GPT', 'hey'),
          msg('claude', 'Claude', 'hello'),
        ],
      }),
    );
    expect(turns).toEqual([
      { role: 'other', text: '[Tony]: hi all\n\n[GPT]: hey', images: [] },
      { role: 'self', text: 'hello', images: [] },
    ]);
  });

  it('carries image attachments through, merged in coalesced turns', () => {
    const img = { mediaType: 'image/png' as const, dataBase64: 'AAAA' };
    const turns = toTurns(
      ctx({
        transcript: [msg('user', 'Tony', 'look at this', [img]), msg('gpt', 'GPT', 'nice')],
      }),
    );
    expect(turns).toEqual([{ role: 'other', text: '[Tony]: look at this\n\n[GPT]: nice', images: [img] }]);
  });
});

describe('parseToolDecision', () => {
  it('maps send_message to a message decision', () => {
    expect(parseToolDecision('send_message', { text: 'hi' })).toEqual({ kind: 'message', text: 'hi' });
  });

  it('maps react to a reaction decision', () => {
    expect(parseToolDecision('react', { emoji: '🔥' })).toEqual({ kind: 'react', emoji: '🔥' });
  });

  it('maps stay_silent — and anything malformed — to silence', () => {
    expect(parseToolDecision('stay_silent', {})).toEqual({ kind: 'silent' });
    expect(parseToolDecision('send_message', {})).toEqual({ kind: 'silent' });
    expect(parseToolDecision('send_message', { text: '   ' })).toEqual({ kind: 'silent' });
    expect(parseToolDecision('react', {})).toEqual({ kind: 'silent' });
    expect(parseToolDecision('unknown_tool', { text: 'x' })).toEqual({ kind: 'silent' });
  });
});
