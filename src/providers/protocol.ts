import type { DecisionContext } from '../core/orchestrator';
import type { AgentDecision, ImageAttachment } from '../core/types';

/**
 * Provider-neutral pieces of the decision protocol: the system prompt that
 * harnesses each model into group-chat restraint, the transcript-to-turns
 * conversion, and the decision tool definitions + parsing.
 */

export interface Turn {
  /** 'self' = this agent's own past messages; 'other' = everyone else. */
  role: 'self' | 'other';
  text: string;
  images: ImageAttachment[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  required: string[];
}

export const DECISION_TOOLS: ToolDef[] = [
  {
    name: 'send_message',
    description:
      'Post a message to the group chat. Use only when you add something genuinely new or were asked directly.',
    parameters: {
      text: {
        type: 'string',
        description: 'Your message. Keep it short and conversational. You may tag others with @handle.',
      },
    },
    required: ['text'],
  },
  {
    name: 'react',
    description: 'Attach a single emoji reaction to the latest message instead of replying.',
    parameters: {
      emoji: { type: 'string', description: 'One emoji, e.g. "👍" or "🔥".' },
    },
    required: ['emoji'],
  },
  {
    name: 'stay_silent',
    description: 'Read the message and say nothing. This is the right choice most of the time.',
    parameters: {},
    required: [],
  },
];

export function buildSystemPrompt(ctx: DecisionContext): string {
  const { agent, otherParticipants, wasMentioned } = ctx;
  const lines = [
    `You are ${agent.name} (handle @${agent.id}), one participant in a group chat.`,
    `Also in the room: the human, and these AI assistants: ${otherParticipants.join(', ') || '(none)'}.`,
    '',
    'This is a group conversation, not a 1:1 assistant chat. House rules:',
    '- You are NOT expected to reply to every message. Choosing stay_silent is normal and respected.',
    '- Speak only when you add something new: a different answer, a correction, a missing angle. Never restate what someone already said.',
    '- If another participant already answered well, stay_silent or react — do not pile on.',
    '- If you are @-mentioned, you are expected to respond.',
    '- Keep messages short and conversational, like a sharp colleague in a chat thread, not an essay.',
    '- You may tag others with their @handle when you genuinely want their input. Do not tag people just to be polite — tags summon them.',
    '- Do not drag topics on. If the thread has reached a good answer, let it end.',
    '',
    'You must respond by calling exactly one tool: send_message, react, or stay_silent.',
  ];
  if (wasMentioned) {
    lines.push('', 'You were mentioned in the latest activity — the group is expecting your reply.');
  }
  if (agent.persona) {
    lines.push('', `Your persona: ${agent.persona}`);
  }
  return lines.join('\n');
}

/**
 * Flatten the group transcript into alternating self/other turns.
 * Other participants' messages are prefixed "[Name]: " so the model can
 * tell speakers apart; consecutive other-turns are coalesced because some
 * providers require strict role alternation.
 */
export function toTurns(ctx: DecisionContext): Turn[] {
  const turns: Turn[] = [];
  for (const m of ctx.transcript) {
    const self = m.authorId === ctx.agent.id;
    const text = self ? m.text : `[${m.authorName}]: ${m.text}`;
    const last = turns[turns.length - 1];
    if (last && last.role === (self ? 'self' : 'other')) {
      last.text += `\n\n${text}`;
      last.images.push(...m.images);
    } else {
      turns.push({ role: self ? 'self' : 'other', text, images: [...m.images] });
    }
  }
  return turns;
}

/** Map a raw tool call from any provider into a decision; malformed input means silence. */
export function parseToolDecision(name: string, args: Record<string, unknown>): AgentDecision {
  if (name === 'send_message' && typeof args.text === 'string' && args.text.trim() !== '') {
    return { kind: 'message', text: args.text };
  }
  if (name === 'react' && typeof args.emoji === 'string' && args.emoji.trim() !== '') {
    return { kind: 'react', emoji: args.emoji };
  }
  return { kind: 'silent' };
}
