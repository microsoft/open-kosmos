import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../calculators/TextTokenCalculator', () => {
  class TextTokenCalculator {
    countTokens(text: string) { return text.length; }
  }
  return { TextTokenCalculator };
});

vi.mock('../calculators/ImageTokenCalculator', () => {
  class ImageTokenCalculator {
    calculateTokens() { return { tokens: 100 }; }
    calculateFromImagePart() { return { tokens: 100 }; }
  }
  return { ImageTokenCalculator };
});

vi.mock('../calculators/ToolsTokenCalculator', () => {
  class ToolsTokenCalculator {
    calculateAllToolsTokens() { return { totalTokens: 0, tools: [] }; }
  }
  return { ToolsTokenCalculator };
});

import { TokenCounter } from '../TokenCounter';
import type { Message } from '../types';

function makeMessage(overrides: any = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    timestamp: Date.now(),
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  } as Message;
}

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter();
  });

  describe('countMessagesTokens', () => {
    it('returns 3 for an empty message array (BASE_TOKENS_PER_COMPLETION overhead)', () => {
      expect(counter.countMessagesTokens([])).toBe(3);
    });

    it('adds +3 completion overhead on top of individual message tokens', () => {
      // text "hello" has length 5 → textCalculator returns 5
      // countMessageTokens = 3 (BASE_TOKENS_PER_MESSAGE) + 5 = 8
      // countMessagesTokens = 3 (BASE_TOKENS_PER_COMPLETION) + 8 = 11
      const message = makeMessage({ content: [{ type: 'text', text: 'hello' }] });
      expect(counter.countMessagesTokens([message])).toBe(11);
    });

    it('sums tokens for multiple messages plus +3 completion overhead', () => {
      // Each message: 3 + text.length
      // "hi" (2) → 5 tokens per message
      // Two messages: 5 + 5 = 10, plus 3 = 13
      const msg1 = makeMessage({ content: [{ type: 'text', text: 'hi' }] });
      const msg2 = makeMessage({ content: [{ type: 'text', text: 'hi' }] });
      expect(counter.countMessagesTokens([msg1, msg2])).toBe(13);
    });
  });

  describe('countMessageTokens', () => {
    it('adds +3 (BASE_TOKENS_PER_MESSAGE) to text content tokens', () => {
      // "hello" length = 5, so total = 3 + 5 = 8
      const message = makeMessage({ content: [{ type: 'text', text: 'hello' }] });
      expect(counter.countMessageTokens(message)).toBe(8);
    });

    it('handles empty content (no parts) — returns only BASE_TOKENS_PER_MESSAGE', () => {
      const message = makeMessage({ content: [] });
      expect(counter.countMessageTokens(message)).toBe(3);
    });

    it('applies ×1.5 safety margin (ceiling) to tool_calls tokens for assistant messages', () => {
      // tool_calls: one call whose JSON string length determines tokens
      // JSON.stringify({ id: 'tc1' }) = '{"id":"tc1"}' → length 12
      // toolCallTokens = 12, Math.ceil(12 * 1.5) = 18
      // text "ok" (length 2) → total = 3 + 2 + 18 = 23
      const toolCall = { id: 'tc1' };
      const jsonLen = JSON.stringify(toolCall).length; // 12
      const expectedToolTokens = Math.ceil(jsonLen * 1.5); // 18
      const message = makeMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        tool_calls: [toolCall],
      });
      expect(counter.countMessageTokens(message)).toBe(3 + 2 + expectedToolTokens);
    });

    it('does NOT apply tool_calls margin for non-assistant roles', () => {
      const message = makeMessage({
        role: 'user',
        content: [{ type: 'text', text: 'ok' }],
        tool_calls: [{ id: 'tc1' }],
      });
      // user role → tool_calls block is skipped; 3 + 2 = 5
      expect(counter.countMessageTokens(message)).toBe(5);
    });

    it('adds name token count + BASE_TOKENS_PER_NAME (+1) when name is present', () => {
      // name "alice" length = 5, +1 overhead → name contribution = 6
      // text "hi" (2) → total = 3 + 2 + 5 + 1 = 11
      const message: Message & { name: string } = {
        ...makeMessage({ content: [{ type: 'text', text: 'hi' }] }),
        name: 'alice',
      };
      expect(counter.countMessageTokens(message)).toBe(11);
    });

    it('does not add name overhead when name is absent', () => {
      const message = makeMessage({ content: [{ type: 'text', text: 'hi' }] });
      expect(counter.countMessageTokens(message)).toBe(5);
    });

    it('ignores content parts with unknown type (neither text nor image)', () => {
      // Covers: else-if part.type === 'image' false branch (line 71)
      // Unknown part types should be silently skipped
      const message = makeMessage({
        content: [
          { type: 'text', text: 'hi' },
          { type: 'unknown', data: 'some data' }, // unknown type, should be skipped
        ],
      });
      // Only the text part contributes: BASE_TOKENS_PER_MESSAGE(3) + text.length(2) = 5
      expect(counter.countMessageTokens(message)).toBe(5);
    });
  });
});
