import React, { useCallback, useEffect, useRef, useState } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
}

interface Reaction {
  authorId: string;
  authorName: string;
  emoji: string;
}

interface ImageAttachment {
  mediaType: string;
  dataBase64: string;
}

interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  images: ImageAttachment[];
  mentions: string[];
  reactions: Reaction[];
  createdAt: number;
}

type RoomEvent =
  | { type: 'thinking'; agentId: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'reaction'; messageId: string; reaction: Reaction }
  | { type: 'silent'; agentId: string }
  | { type: 'error'; agentId: string; error: string };

const HUES = [16, 200, 265, 130, 330, 45, 180];

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return HUES[h % HUES.length]!;
}

function renderText(text: string, agentIds: string[]) {
  const parts = text.split(/(@[a-z0-9-]+)/gi);
  return parts.map((part, i) =>
    part.startsWith('@') && agentIds.includes(part.slice(1).toLowerCase()) ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentIds = agents.map((a) => a.id);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((s) => {
        setAgents(s.agents);
        setMessages(s.messages);
      });

    const source = new EventSource('/api/events');
    source.onmessage = (e) => {
      const event: RoomEvent = JSON.parse(e.data);
      if (event.type === 'thinking') {
        setThinking((prev) => new Set(prev).add(event.agentId));
        return;
      }
      if ('agentId' in event || event.type === 'message' || event.type === 'reaction') {
        const doneAgent =
          event.type === 'message' ? event.message.authorId : 'agentId' in event ? event.agentId : null;
        if (doneAgent) {
          setThinking((prev) => {
            const next = new Set(prev);
            next.delete(doneAgent);
            return next;
          });
        }
      }
      if (event.type === 'message') {
        setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]));
      } else if (event.type === 'reaction') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, reactions: [...m.reactions, event.reaction] } : m)),
        );
        setThinking((prev) => {
          const next = new Set(prev);
          next.delete(event.reaction.authorId);
          return next;
        });
      } else if (event.type === 'error') {
        setErrors((prev) => [...prev.slice(-4), `${event.agentId}: ${event.error}`]);
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed === '' && pendingImages.length === 0) return;
    void fetch('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: trimmed, images: pendingImages }),
    });
    setText('');
    setPendingImages([]);
  }, [text, pendingImages]);

  const attachImages = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        const [, dataBase64 = ''] = url.split(',', 2);
        setPendingImages((prev) => [...prev, { mediaType: file.type, dataBase64 }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const reset = useCallback(() => {
    if (!confirm('Clear the whole conversation?')) return;
    void fetch('/api/reset', { method: 'POST' }).then(() => setMessages([]));
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>groop</h1>
        <p className="tagline">all your models, one room</p>
        <div className="roster">
          {agents.map((a) => (
            <div key={a.id} className="roster-item">
              <span className="avatar" style={{ background: `hsl(${hue(a.id)} 70% 55%)` }}>
                {a.name[0]}
              </span>
              <div>
                <div className="roster-name">{a.name}</div>
                <div className="roster-model">
                  @{a.id} · {a.model}
                </div>
              </div>
              {thinking.has(a.id) && <span className="dot-pulse" title="thinking" />}
            </div>
          ))}
        </div>
        <button className="reset" onClick={reset}>
          Clear chat
        </button>
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">
              Say something. Agents decide for themselves whether to reply, react, or just read.
              Tag one with @handle to summon it.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`message ${m.authorId === 'user' ? 'mine' : ''}`}>
              {m.authorId !== 'user' && (
                <span className="avatar" style={{ background: `hsl(${hue(m.authorId)} 70% 55%)` }}>
                  {m.authorName[0]}
                </span>
              )}
              <div className="bubble">
                <div className="author">{m.authorName}</div>
                {m.images.map((img, i) => (
                  <img key={i} className="attachment" src={`data:${img.mediaType};base64,${img.dataBase64}`} alt="" />
                ))}
                {m.text && <div className="text">{renderText(m.text, agentIds)}</div>}
                {m.reactions.length > 0 && (
                  <div className="reactions">
                    {m.reactions.map((r, i) => (
                      <span key={i} className="reaction" title={r.authorName}>
                        {r.emoji} <em>{r.authorName}</em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {[...thinking].map((id) => (
            <div key={id} className="thinking-row">
              {agents.find((a) => a.id === id)?.name ?? id} is thinking…
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {errors.length > 0 && (
          <div className="errors">
            {errors.map((e, i) => (
              <div key={i}>⚠ {e}</div>
            ))}
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className="pending-images">
            {pendingImages.map((img, i) => (
              <img key={i} src={`data:${img.mediaType};base64,${img.dataBase64}`} alt="" />
            ))}
            <button onClick={() => setPendingImages([])}>✕</button>
          </div>
        )}

        <div className="composer">
          <label className="attach">
            📎
            <input type="file" accept="image/*" multiple hidden onChange={(e) => attachImages(e.target.files)} />
          </label>
          <textarea
            value={text}
            placeholder="Message the room… (@handle to tag)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="send" onClick={send}>
            Send
          </button>
        </div>
      </main>
    </div>
  );
}
