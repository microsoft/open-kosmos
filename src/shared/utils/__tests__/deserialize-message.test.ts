import { deserializeMessage } from '../deserialize-message';

describe('deserializeMessage', () => {
  describe('user messages', () => {
    it('parses a basic user message', () => {
      const raw = {
        id: 'msg-1',
        role: 'user',
        timestamp: 1000,
        content: [{ type: 'text', text: 'hello' }],
      };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('user');
      expect(msg.id).toBe('msg-1');
      expect(msg.timestamp).toBe(1000);
      expect(msg.content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('keeps all valid user content types: text, image, file, office, others', () => {
      const raw = {
        role: 'user',
        id: 'u-all',
        timestamp: 500,
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', url: 'img' },
          { type: 'file', path: 'f' },
          { type: 'office', path: 'o' },
          { type: 'others', data: 'x' },
        ],
      };
      const msg = deserializeMessage(raw);
      expect(msg.content).toHaveLength(5);
    });

    it('filters out non-user content parts', () => {
      const raw = {
        id: 'msg-2',
        role: 'user',
        timestamp: 1000,
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image', url: 'test.png' },
          { type: 'unknown_type', data: 'x' },
        ],
      };
      const msg = deserializeMessage(raw);
      expect(msg.content).toHaveLength(2); // text + image, not unknown_type
    });

    it('generates id when missing', () => {
      const raw = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
      const msg = deserializeMessage(raw);
      expect(msg.id).toMatch(/^msg_/);
    });

    it('generates id when id is empty string', () => {
      const raw = { id: '', role: 'user', content: [{ type: 'text', text: 'hi' }] };
      const msg = deserializeMessage(raw);
      expect(msg.id).toMatch(/^msg_/);
    });

    it('uses Date.now() when timestamp is missing', () => {
      const before = Date.now();
      const raw = { role: 'user', content: [] };
      const msg = deserializeMessage(raw);
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('parses string timestamp', () => {
      const raw = {
        role: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        content: [],
      };
      const msg = deserializeMessage(raw);
      expect(msg.timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'));
    });

    it('falls back to Date.now() for invalid string timestamp', () => {
      const before = Date.now();
      const raw = { role: 'user', timestamp: 'not-a-date', content: [] };
      const msg = deserializeMessage(raw);
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('handles missing content as empty array', () => {
      const raw = { role: 'user' };
      const msg = deserializeMessage(raw);
      expect(msg.content).toEqual([]);
    });
  });

  describe('assistant messages', () => {
    it('parses assistant message with text and thinking parts', () => {
      const raw = {
        id: 'asst-1',
        role: 'assistant',
        timestamp: 2000,
        content: [
          { type: 'text', text: 'response' },
          { type: 'thinking', thinking: 'hmm' },
          { type: 'image', url: 'no' }, // should be filtered
        ],
        tool_calls: [{ id: 'tc1', name: 'test', arguments: '{}' }],
        streamingComplete: true,
        usage: { promptTokens: 10, completionTokens: 20 },
        model: 'gpt-4',
      };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('assistant');
      expect(msg.content).toHaveLength(2); // text + thinking
      expect((msg as any).tool_calls).toEqual([{ id: 'tc1', name: 'test', arguments: '{}' }]);
      expect((msg as any).streamingComplete).toBe(true);
      expect((msg as any).usage).toEqual({ promptTokens: 10, completionTokens: 20 });
      expect((msg as any).model).toBe('gpt-4');
    });

    it('treats "thinking" role as assistant', () => {
      const raw = { role: 'thinking', id: 't1', timestamp: 100, content: [{ type: 'text', text: 'x' }] };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('assistant');
    });
  });

  describe('tool messages', () => {
    it('parses tool message', () => {
      const raw = {
        id: 'tool-1',
        role: 'tool',
        timestamp: 3000,
        content: [{ type: 'text', text: 'result' }, { type: 'image', url: 'skip' }],
        tool_call_id: 'tc1',
        name: 'search',
        streamingComplete: true,
      };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('tool');
      expect(msg.content).toHaveLength(1); // only text
      expect((msg as any).tool_call_id).toBe('tc1');
      expect((msg as any).name).toBe('search');
    });

    it('defaults name to "unknown_tool" when missing', () => {
      const raw = { role: 'tool', content: [], tool_call_id: 'tc2' };
      const msg = deserializeMessage(raw);
      expect((msg as any).name).toBe('unknown_tool');
    });
  });

  describe('system messages', () => {
    it('parses system message filtering to text parts only', () => {
      const raw = {
        id: 'sys-1',
        role: 'system',
        timestamp: 4000,
        content: [{ type: 'text', text: 'system prompt' }, { type: 'image', url: 'no' }],
      };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('system');
      expect(msg.content).toHaveLength(1);
    });

    it('keeps only text parts, filtering thinking and others', () => {
      const raw = {
        role: 'system',
        id: 'sys-2',
        timestamp: 5000,
        content: [
          { type: 'text', text: 'a' },
          { type: 'thinking', thinking: 'b' },
          { type: 'file', path: 'c' },
        ],
      };
      const msg = deserializeMessage(raw);
      expect(msg.content).toHaveLength(1);
      expect((msg.content[0] as any).text).toBe('a');
    });
  });

  describe('unknown role', () => {
    it('defaults to user message for unknown roles', () => {
      const raw = { role: 'unknown_role', content: [{ type: 'text', text: 'x' }] };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('user');
    });
  });

  describe('missing content fallbacks', () => {
    it('assistant message with no content defaults to empty array', () => {
      const raw = { role: 'assistant', id: 'a1', timestamp: 1000 };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('assistant');
      expect(msg.content).toEqual([]);
    });

    it('tool message with no content defaults to empty array', () => {
      const raw = { role: 'tool', id: 't1', timestamp: 1000, tool_call_id: 'tc1', name: 'fn' };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('tool');
      expect(msg.content).toEqual([]);
    });

    it('system message with no content defaults to empty array', () => {
      const raw = { role: 'system', id: 's1', timestamp: 1000 };
      const msg = deserializeMessage(raw);
      expect(msg.role).toBe('system');
      expect(msg.content).toEqual([]);
    });
  });
});
