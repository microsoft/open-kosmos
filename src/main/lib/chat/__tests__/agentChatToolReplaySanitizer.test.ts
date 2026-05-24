// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger to avoid real logger initialization
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  sanitizeFormattedToolReplayMessages,
  sanitizeIncompleteToolCallMessages,
} from '../agentChatToolReplaySanitizer';
import type { Message, AssistantMessage, ToolMessage, UserMessage } from '@shared/types/chatTypes';

// Builders for typed messages
function makeUser(id: string): UserMessage {
  return { id, role: 'user', timestamp: 0, content: [{ type: 'text', text: 'hi' }] };
}

function makeAssistant(id: string, toolCallIds: string[] = [], text = 'thinking'): AssistantMessage {
  const tool_calls = toolCallIds.map((tcId) => ({
    id: tcId,
    type: 'function' as const,
    function: { name: 'test_tool', arguments: '{}' },
  }));
  return {
    id,
    role: 'assistant',
    timestamp: 0,
    content: [{ type: 'text', text }],
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

// Raw "formatted" messages (plain objects for sanitizeFormattedToolReplayMessages)
function rawAssistant(id: string, toolCallIds: string[], content?: string) {
  const obj: any = { id, role: 'assistant', content: content ?? 'thinking' };
  if (toolCallIds.length > 0) {
    obj.tool_calls = toolCallIds.map((tcId) => ({ id: tcId, function: { name: 'fn', arguments: '{}' } }));
  }
  return obj;
}

function rawTool(id: string, toolCallId: string) {
  return { id, role: 'tool', tool_call_id: toolCallId, content: 'result' };
}

describe('sanitizeFormattedToolReplayMessages', () => {
  it('returns empty/null array unchanged', () => {
    expect(sanitizeFormattedToolReplayMessages([])).toEqual([]);
  });

  it('passes through messages with no tool calls', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it('keeps valid assistant + tool message pairs', () => {
    const msgs = [
      rawAssistant('a1', ['tc1']),
      rawTool('t1', 'tc1'),
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    const toolMsgs = result.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
  });

  it('removes assistant messages whose tool_calls have no matching tool results', () => {
    const msgs = [
      rawAssistant('a1', ['tc1']),
      // no following tool message
      { role: 'user', content: 'next' },
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    // The assistant block has no content besides tool_calls=>'', so the assistant may be dropped
    // The user message must survive
    const userMsgs = result.filter((m: any) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    const toolMsgs = result.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(0);
  });

  it('strips unmatched tool_calls from assistant but keeps the message when it has content', () => {
    const msgs = [
      rawAssistant('a1', ['tc1', 'tc2'], 'some content'),
      rawTool('t1', 'tc1'),
      // tc2 has no result
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    const aMsg = result.find((m: any) => m.role === 'assistant');
    expect(aMsg).toBeDefined();
    // tc2 should be removed
    const toolCallIds = aMsg.tool_calls?.map((tc: any) => tc.id);
    expect(toolCallIds).not.toContain('tc2');
  });

  it('removes duplicate contiguous tool messages with the same tool_call_id', () => {
    const msgs = [
      rawAssistant('a1', ['tc1']),
      rawTool('t1a', 'tc1'),
      rawTool('t1b', 'tc1'), // duplicate
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    const toolMsgs = result.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
  });

  it('handles multiple valid blocks in sequence', () => {
    const msgs = [
      rawAssistant('a1', ['tc1']),
      rawTool('t1', 'tc1'),
      { role: 'user', content: 'next' },
      rawAssistant('a2', ['tc2']),
      rawTool('t2', 'tc2'),
    ];
    const result = sanitizeFormattedToolReplayMessages(msgs);
    const toolMsgs = result.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });
});

describe('sanitizeIncompleteToolCallMessages', () => {
  const noopSanitizer = (toolCalls: any[]) => ({ toolCalls, sanitizedCount: 0 });

  it('returns empty array unchanged', () => {
    expect(sanitizeIncompleteToolCallMessages([], noopSanitizer)).toEqual([]);
  });

  it('passes through messages without tool calls', () => {
    const msgs: Message[] = [makeUser('u1'), makeAssistant('a1')];
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    expect(result).toHaveLength(2);
  });

  it('keeps valid assistant + tool message pairs', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
    ];
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    expect(result.filter((m) => m.role === 'tool')).toHaveLength(1);
  });

  it('removes unmatched tool messages', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc_WRONG'),
    ];
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    expect(result.filter((m) => m.role === 'tool')).toHaveLength(0);
  });

  it('calls sanitizeToolCallsForApi on matched tool calls', () => {
    const sanitizerSpy = vi.fn((toolCalls: any[]) => ({ toolCalls, sanitizedCount: 0 }));
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
    ];
    sanitizeIncompleteToolCallMessages(msgs, sanitizerSpy);
    expect(sanitizerSpy).toHaveBeenCalled();
  });

  it('reflects sanitized count from sanitizeToolCallsForApi in returned messages', () => {
    // When sanitizedCount > 0 the message is re-created with sanitized calls
    const sanitizerWithCount = (toolCalls: any[]) => ({
      toolCalls: toolCalls.map((tc) => ({ ...tc, function: { name: tc.function.name, arguments: '{"fixed":true}' } })),
      sanitizedCount: 1,
    });
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
    ];
    const result = sanitizeIncompleteToolCallMessages(msgs, sanitizerWithCount);
    const aMsg = result.find((m) => m.role === 'assistant') as AssistantMessage;
    expect(aMsg.tool_calls![0].function.arguments).toBe('{"fixed":true}');
  });

  it('removes duplicate tool messages', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1a', 'tc1'),
      makeTool('t1b', 'tc1'), // duplicate
    ];
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    expect(result.filter((m) => m.role === 'tool')).toHaveLength(1);
  });

  it('drops assistant message when it has no text content and no matched tool calls', () => {
    // Make an assistant with only tool_calls, no text
    const noTextAssistant: AssistantMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: 0,
      content: [{ type: 'text', text: '' }],
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
    };
    const msgs: Message[] = [noTextAssistant]; // no tool result
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    const assistants = result.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(0);
  });

  it('handles multiple valid blocks in sequence', () => {
    const msgs: Message[] = [
      makeAssistant('a1', ['tc1']),
      makeTool('t1', 'tc1'),
      makeUser('u1'),
      makeAssistant('a2', ['tc2']),
      makeTool('t2', 'tc2'),
    ];
    const result = sanitizeIncompleteToolCallMessages(msgs, noopSanitizer);
    expect(result.filter((m) => m.role === 'tool')).toHaveLength(2);
  });
});
