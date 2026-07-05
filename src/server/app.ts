import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ImageAttachment } from '../core/types';
import type { Room } from './room';

export function createApp(room: Room) {
  const app = new Hono();

  app.get('/api/state', (c) =>
    c.json({
      agents: room.agents.map(({ config }) => ({
        id: config.id,
        name: config.name,
        provider: config.provider,
        model: config.model,
      })),
      messages: room.messages,
      busy: room.busy,
    }),
  );

  app.post('/api/messages', async (c) => {
    const body = await c.req.json<{ text?: string; images?: ImageAttachment[]; authorName?: string }>();
    const text = body.text ?? '';
    const images = body.images ?? [];
    if (text.trim() === '' && images.length === 0) {
      return c.json({ error: 'message needs text or an image' }, 400);
    }
    await room.postUserMessage({ text, images, authorName: body.authorName });
    return c.json({ ok: true });
  });

  app.post('/api/reset', (c) => {
    room.reset();
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;
      const unsubscribe = room.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      });
      stream.onAbort(() => {
        alive = false;
        unsubscribe();
      });
      while (alive) {
        await stream.writeSSE({ event: 'ping', data: '' });
        await new Promise((r) => setTimeout(r, 15000));
      }
    }),
  );

  return app;
}
