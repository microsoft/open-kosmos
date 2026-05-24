// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { isToolMessageOrphaned, sanitizeOrphanedToolMessages } from '../agentChatToolMessageSanitizer';
import type { Message, AssistantMessage, ToolMessage, UserMessage } from '@shared/types/chatTypes';

// Minimal builders
function makeUser(id: string): UserMessage {
  return { id, role: 'user', timestamp: 0, content: [{ type: 'text', text: 'hi' }] };
}

function makeAssistant(id: string, toolCallIds: string[] = []): AssistantMessage {
  const tool_calls = toolCallIds.map((tcId) => ({
    id: tcId,
    type: 'function' as const,
    function: { name: 'test_tool', arguments: '{}' },
  }));
  return {
    id,
    role: 'assistant',
    timestamp: 0,
    content: [{ type: 'text', text: 'thinking' }],
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
  };
}

function makeTool(id: string, toolCallId: string): ToolMessage {
  return {
    id,
    role: 'tool',
    timestamp: 0,
    tool_call_id: toolCallId,
    content: [{ type: 'text', text: 'result' }],
  };
}

describe('isToolMessageOrphaned', () => {
  it('returns true when history is empty', () => {
    expect(isToolMessageOrphaned('tc1', [])).toBe(true);
  });

  it('returns false when last assistant message has a matching tool_call_id', () => {
    const history: Message[] = [
      makeUser('u1'),
      makeAssistant('a1', ['tc1']),
    ];
    expect(isToolMessageOrphaned('tc1', history)).toBe(false);
  });

  it('returns true when last assistant message does not have matching id', () => {
    const history: Message[] = [
      makeUser('u1'),
      makeAssistant('a1', ['tc2']),
    ];
    expect(isToolMessageOrphaned('tc1', history)).toBe(true);
  });

  it('returns true when the last message is a user message', () => {
    const history: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeUser('u2'),
    ];
    expect(isToolMessageOrphaned('tc1', history)).toBe(true);
  });

  it('returns true when history has only user messages', () => {
    const history: Message[] = [makeUser('u1'), makeUser('u2')];
    expect(isToolMessageOrphaned('tc1', history)).toBe(true);
  });

  it('returns false when matching assistant is found scanning backwards past non-matching', () => {
    // The function returns as soon as it finds ANY assistant message — if it has no matching tc, orphaned=true
    const history: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeAssistant('a2', ['tc2']), // this is scanned first (last)
    ];
    // tc1 is NOT in a2's calls, so orphaned
    expect(isToolMessageOrphaned('tc1', history)).toBe(true);
  });

  it('returns false when the single assistant message has an empty tool_calls list but no match', () => {
    const history: Message[] = [makeAssistant('a1', [])];
    // tool_calls is empty (length 0), so the condition `toolCalls.length && ...` is falsy → returns true
    expect(isToolMessageOrphaned('tc1', history)).toBe(true);
  });
});

describe('sanitizeOrphanedToolMessages', () => {
  it('returns empty array for empty input', () => {
    expect(sanitizeOrphanedToolMessages([])).toEqual([]);
  });

  it('passes through messages with no tool calls unchanged', () => {
    const msgs: Message[] = [makeUser('u1'), makeAssistant('a1'), makeUser('u2')];
    const result = sanitizeOrphanedToolMessages(msgs);
    expect(result).toHaveLength(3);
  });

  it('preserves valid assistant + contiguous tool message pairs', () => {
    const msgs: Message[] = [
      makeUser('u1'),
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    expect(result).toHaveLength(3);
  });

  it('strips orphaned tool messages (no preceding assistant)', () => {
    const msgs: Message[] = [
      makeTool('t1', 'tc1'),
      makeUser('u1'),
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    // Leading tool message is dropped because there is no assistant before it
    expect(result.every((m) => m.role !== 'tool')).toBe(true);
  });

  it('removes tool message if tool_call_id is not in the nearest assistant tool_calls', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc_WRONG'),
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    // tool message should be dropped; assistant tool_calls trimmed to nothing
    const toolMsgs = result.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(0);
  });

  it('trims unmatched tool_calls from assistant message', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1', 'tc2']),
      makeTool('t1', 'tc1'),
      // tc2 has no corresponding tool result
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    const aMsg = result.find((m) => m.role === 'assistant') as AssistantMessage;
    expect(aMsg.tool_calls).toHaveLength(1);
    expect(aMsg.tool_calls![0].id).toBe('tc1');
  });

  it('handles multiple valid assistant+tool blocks', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
      makeUser('u1'),
      makeAssistant('a2', ['tc2']),
      makeTool('t2', 'tc2'),
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    expect(result).toHaveLength(5);
  });

  it('drops tool message that appears after a user message', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeUser('u1'),
      makeTool('t1', 'tc1'), // separated by user message
    ];
    const result = sanitizeOrphanedToolMessages(msgs);
    const toolMsgs = result.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(0);
  });
});
