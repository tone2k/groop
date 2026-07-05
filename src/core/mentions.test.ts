import { describe, expect, it } from 'vitest';
import { parseMentions } from './mentions';

const known = ['claude', 'gpt', 'gemini', 'local-llama'];

describe('parseMentions', () => {
  it('finds a known handle', () => {
    expect(parseMentions('hey @claude what do you think?', known)).toEqual(['claude']);
  });

  it('ignores unknown handles', () => {
    expect(parseMentions('cc @nobody and @gpt', known)).toEqual(['gpt']);
  });

  it('is case-insensitive and dedupes, preserving first-seen order', () => {
    expect(parseMentions('@GPT then @claude then @gpt again', known)).toEqual(['gpt', 'claude']);
  });

  it('handles punctuation right after the handle', () => {
    expect(parseMentions('thanks @claude! and @gemini, you too.', known)).toEqual(['claude', 'gemini']);
  });

  it('supports handles containing a hyphen', () => {
    expect(parseMentions('@local-llama run this offline', known)).toEqual(['local-llama']);
  });

  it('does not match mid-word at-signs or partial handles', () => {
    expect(parseMentions('email me a@claude.ai and @gp', known)).toEqual([]);
  });

  it('returns empty for empty text', () => {
    expect(parseMentions('', known)).toEqual([]);
  });
});
