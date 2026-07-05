import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelClient } from '../core/orchestrator';
import type { AgentConfig } from '../core/types';
import { createApp } from './app';
import { Room } from './room';

function agent(id: string, client: ModelClient) {
  const config: AgentConfig = { id, name: id.toUpperCase(), provider: 'anthropic', model: 'test' };
  return { config, client };
}

const echoClient: ModelClient = {
  async decide(ctx) {
    const last = ctx.transcript[ctx.transcript.length - 1]!;
    return { kind: 'message', text: `echo: ${last.text}` };
  },
};

const silentClient: ModelClient = { async decide() { return { kind: 'silent' }; } };

describe('HTTP app', () => {
  let room: Room;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    room = new Room({ agents: [agent('claude', echoClient), agent('gpt', silentClient)] });
    app = createApp(room);
  });

  it('GET /api/state lists agents and starts with no messages', async () => {
    const res = await app.request('/api/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([
      { id: 'claude', name: 'CLAUDE', provider: 'anthropic', model: 'test' },
      { id: 'gpt', name: 'GPT', provider: 'anthropic', model: 'test' },
    ]);
    expect(body.messages).toEqual([]);
  });

  it('POST /api/messages stores the user message and the agent replies', async () => {
    const res = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello @gpt', authorName: 'Tony' }),
    });
    expect(res.status).toBe(200);

    const state = await (await app.request('/api/state')).json();
    expect(state.messages.map((m: { authorId: string }) => m.authorId)).toEqual(['user', 'claude']);
    expect(state.messages[0].mentions).toEqual(['gpt']);
    expect(state.messages[0].authorName).toBe('Tony');
    expect(state.messages[1].text).toBe('echo: hello @gpt');
  });

  it('rejects a message with no text and no images', async () => {
    const res = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/reset clears the transcript', async () => {
    await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    await app.request('/api/reset', { method: 'POST' });
    const state = await (await app.request('/api/state')).json();
    expect(state.messages).toEqual([]);
  });
});

describe('Room', () => {
  it('serializes overlapping user messages so orchestrations do not interleave', async () => {
    const order: string[] = [];
    const slow: ModelClient = {
      async decide(ctx) {
        const last = ctx.transcript[ctx.transcript.length - 1]!;
        order.push(`start:${last.text}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end:${last.text}`);
        return { kind: 'silent' };
      },
    };
    const room = new Room({ agents: [agent('claude', slow)] });
    await Promise.all([
      room.postUserMessage({ text: 'first' }),
      room.postUserMessage({ text: 'second' }),
    ]);
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('emits events to subscribers for user and agent messages', async () => {
    const room = new Room({ agents: [agent('claude', echoClient)] });
    const events: string[] = [];
    room.subscribe((e) => events.push(e.type));
    await room.postUserMessage({ text: 'hi' });
    expect(events).toEqual(['message', 'thinking', 'message']);
  });
});
