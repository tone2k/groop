/**
 * Extract @-mentions of known agent handles from message text.
 * Returns handles (lowercase) in first-seen order, deduped.
 */
export function parseMentions(text: string, knownIds: string[]): string[] {
  const known = new Set(knownIds.map((id) => id.toLowerCase()));
  const found: string[] = [];
  // An @ not preceded by a word character, followed by a handle-shaped token.
  const re = /(^|[^\w@])@([a-z0-9][a-z0-9-]*)/gi;
  for (const match of text.matchAll(re)) {
    const handle = match[2]!.toLowerCase();
    if (known.has(handle) && !found.includes(handle)) found.push(handle);
  }
  return found;
}
