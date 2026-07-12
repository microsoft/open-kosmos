/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render } from '@testing-library/react';
import { ToolCallsSection, ToolCallsMessagesContext } from '../ToolCallsSection';
import type { Message, ToolCall } from '@shared/types/chatTypes';

// Main chat session messages (what useMessages returns). Kept empty so that any
// "completed" status can only come from the context override, never the session.
const sessionMessages: Message[] = [];

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => sessionMessages,
}));

const toolCall: ToolCall = {
  id: 'call_dt',
  type: 'function',
  function: { name: 'get_current_datetime', arguments: '{}' },
};

function completedResult(): Message {
  return {
    id: 'result_dt',
    role: 'tool',
    content: [{ type: 'text', text: '{}' }],
    tool_call_id: 'call_dt',
    name: 'get_current_datetime',
    streamingComplete: true,
    timestamp: Date.now(),
  };
}

describe('ToolCallsSection message-source context override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMessages.length = 0;
  });

  it('resolves tool results from the context override when provided', () => {
    const { container } = render(
      <ToolCallsMessagesContext.Provider value={[completedResult()]}>
        <ToolCallsSection toolCalls={[toolCall]} chatStatus="idle" messageId="m1" />
      </ToolCallsMessagesContext.Provider>
    );

    // Found via the override even though useMessages() returns [] -> completed icon.
    expect(container.querySelector('.tool-status-icon.completed')).toBeTruthy();
    expect(container.querySelector('.tool-status-icon.interrupted')).toBeNull();
  });

  it('reports executing when the override has no result yet', () => {
    const { container } = render(
      <ToolCallsMessagesContext.Provider value={[]}>
        <ToolCallsSection toolCalls={[toolCall]} chatStatus="sending_response" messageId="m2" />
      </ToolCallsMessagesContext.Provider>
    );

    expect(container.querySelector('.tool-status-icon.executing')).toBeTruthy();
    expect(container.querySelector('.tool-status-icon.completed')).toBeNull();
  });

  it('falls back to useMessages() when no override context is present', () => {
    sessionMessages.push(completedResult());

    const { container } = render(
      <ToolCallsSection toolCalls={[toolCall]} chatStatus="idle" messageId="m3" />
    );

    expect(container.querySelector('.tool-status-icon.completed')).toBeTruthy();
  });
});
