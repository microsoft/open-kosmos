/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolCallsSection } from '../ToolCallsSection';
import type { Message, ToolCall } from '@shared/types/chatTypes';

const mockMessages: Message[] = [];

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => mockMessages,
}));

describe('ToolCallsSection execute_command partial output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages.length = 0;
  });

  it('shows partial terminal output while keeping the tool call in executing state', () => {
    const toolCall: ToolCall = {
      id: 'call_execute_command',
      type: 'function',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: 'gh auth login -h github.com -p https -w',
          cwd: '/tmp/session',
          shell: 'zsh'
        })
      }
    };

    const partialToolResult: Message = {
      id: 'call_execute_command',
      role: 'tool',
      content: [{
        type: 'text',
        text: JSON.stringify({
          stdout: '',
          stderr: '! First copy your one-time code: 81ED-AB39\nOpen this URL to continue in your web browser: https://github.com/login/device\n',
          exitCode: null,
          timedOut: false,
          durationMs: 1820,
          cwd: '/tmp/session',
          shell: 'zsh',
          interactiveAuth: {
            commandFamily: 'gh-auth-login',
            deviceCode: '81ED-AB39',
            verificationUri: 'https://github.com/login/device',
            timeoutMs: 900_000,
            startedAt: Date.now() - 30_000
          }
        })
      }],
      tool_call_id: 'call_execute_command',
      name: 'execute_command',
      streamingComplete: false,
      timestamp: Date.now()
    };

    mockMessages.push(partialToolResult);

    const { container } = render(
      <ToolCallsSection
        toolCalls={[toolCall]}
        chatStatus="sending_response"
        messageId="assistant_message"
      />
    );

    const rows = container.querySelectorAll('.tool-calls-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(rows[0]);

    const toolRows = container.querySelectorAll('.tool-call-item-row');
    expect(toolRows.length).toBe(1);
    fireEvent.click(toolRows[0]);

    expect(screen.getByText('Executing...')).toBeTruthy();
    expect(screen.getByText(/81ED-AB39/)).toBeTruthy();
    expect(screen.getByText(/https:\/\/github.com\/login\/device/)).toBeTruthy();
  });
});
