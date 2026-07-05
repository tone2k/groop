import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import type { AgentConfig } from '../core/types';
import { createModelClient } from '../providers/factory';
import { createApp } from './app';
import { Room } from './room';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file — keys must come from the environment
}

interface GroopConfig {
  agents: AgentConfig[];
  maxRounds?: number;
}

const configPath = process.env.GROOP_CONFIG ?? 'groop.config.json';
if (!existsSync(configPath)) {
  console.error(
    `No ${configPath} found. Copy groop.config.example.json to groop.config.json,\n` +
      'pick your agents, and put API keys in .env (see README).',
  );
  process.exit(1);
}
const config: GroopConfig = JSON.parse(readFileSync(configPath, 'utf8'));
if (!Array.isArray(config.agents) || config.agents.length === 0) {
  console.error(`${configPath} must define at least one agent.`);
  process.exit(1);
}

const room = new Room({
  agents: config.agents.map((agent) => ({ config: agent, client: createModelClient(agent) })),
  maxRounds: config.maxRounds,
  persistPath: 'data/room.json',
});

const app = createApp(room);
app.use('/*', serveStatic({ root: 'web/dist' }));
app.get('*', serveStatic({ path: 'web/dist/index.html' }));

const port = Number(process.env.PORT ?? 3117);
serve({ fetch: app.fetch, port }, () => {
  const roster = config.agents.map((a) => `@${a.id} (${a.model})`).join(', ');
  console.log(`groop is up on http://localhost:${port} with ${roster}`);
});
