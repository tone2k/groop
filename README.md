# groop

Group chat with multiple LLMs — cloud or local — in one room.

The twist: agents are **not** forced to answer every message. On each message,
every agent makes a tool call to decide what to do:

- `send_message` — speak, only when it adds something new
- `react` — drop an emoji on the latest message
- `stay_silent` — just read (the most common, by design)

You can tag agents with `@handle` to summon them, and they can tag each
other — tag chains trigger bounded follow-up rounds (`maxRounds`) so topics
don't drag on. You can send images; vision-capable models read them.

## Quick start

```bash
npm install
cp groop.config.example.json groop.config.json   # pick your agents
echo 'ANTHROPIC_API_KEY=sk-...' >> .env          # keys for the agents you kept
npm start                                        # http://localhost:3117
```

For development (UI hot reload on :5173, API on :3117):

```bash
npm run dev:server
npm run dev:web
```

## Configuring agents

`groop.config.json` defines the room. Two provider adapters cover nearly
everything:

| provider            | works with                                                              |
| ------------------- | ----------------------------------------------------------------------- |
| `anthropic`         | Claude models                                                           |
| `openai-compatible` | OpenAI, **Ollama** (local), Groq, xAI, Mistral, Gemini compat endpoint  |

```jsonc
{
  "maxRounds": 3, // agent rounds per user message (bounds tag chains)
  "agents": [
    { "id": "claude", "name": "Claude", "provider": "anthropic", "model": "claude-sonnet-5" },
    {
      "id": "llama",
      "name": "Llama (local)",
      "provider": "openai-compatible",
      "model": "llama3.2",
      "baseUrl": "http://localhost:11434/v1" // no API key needed for Ollama
    }
  ]
}
```

Each agent takes an optional `persona` string appended to its system prompt
(e.g. `"You are the skeptic of the group."`) and an `apiKeyEnv` naming the
env var that holds its key.

## How it works

```
src/core/        the engine — pure logic, fully unit-tested
  mentions.ts      @handle parsing
  policy.ts        who gets polled each round; round cap
  orchestrator.ts  sequential decision polls, cascades, events
src/providers/   protocol.ts (tested: prompt, transcript→turns, tool parsing)
                 + thin Anthropic / OpenAI-compat SDK shells
src/server/      Room (queue + persistence + SSE bus) and the Hono API
web/             React chat UI
```

Agents are polled **sequentially** within a round, so each one sees what
earlier agents already said — that's what makes "someone already answered,
stay silent" actually work. Transcript persists to `data/room.json`.

## Tests

```bash
npm test
```

The test suite covers the parts where bugs would be silent and behavioral:
mention parsing, round planning, the orchestration loop (cascades, caps,
reactions, error isolation), the provider-neutral protocol layer, and the
HTTP API. The SDK shells and the React UI are deliberately thin and left to
integration/manual testing.
