/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';

vi.mock('../../../styles/ChatContainer.css', async () => ({}));
vi.mock('../../../styles/InteractiveRequestCard.css', async () => ({}));
vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  extractFilePathsFromText: vi.fn(() => []),
  CurrentSessionInteractiveRequest: { use: () => null },
}));
vi.mock('../message/Message', () => ({ default: () => <div data-testid="message" /> }));
vi.mock('../ChatInput', () => ({ default: () => <div data-testid="chat-input" /> }));
vi.mock('../ToolCallsSection', async () => ({
  ToolCallsSection: () => <div data-testid="tool-calls-section" />,
}));

const mockShowToast = vi.fn();
vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

import ChatContainer from '../ChatContainer';

describe('ChatContainer interactive auth card', () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  const cancelActiveToolExecution = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));
    mockShowToast.mockReset();
    openSpy.mockClear();
    cancelActiveToolExecution.mockReset();
    cancelActiveToolExecution.mockResolvedValue({ success: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      },
      configurable: true,
      writable: true,
    });
    (window as any).electronAPI = {
      agentChat: {
        cancelActiveToolExecution,
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a timeline auth card parallel to InteractiveRequestCard for partial execute_command auth flows', async () => {
    const assistantMessage: Message = {
      id: 'assistant-1',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: true,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: JSON.stringify({
              command: 'gh auth login -h github.com -p https -w',
              cwd: '/tmp/session',
              shell: 'zsh'
            })
          }
        }
      ]
    };

    const partialToolResult: Message = {
      id: 'tool-call-1',
      role: 'tool',
      name: 'execute_command',
      tool_call_id: 'tool-call-1',
      streamingComplete: false,
      timestamp: Date.now(),
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
            startedAt: Date.now() - 30_000,
          }
        })
      }]
    };

    render(
      <ChatContainer
        messages={[assistantMessage]}
        allMessages={[assistantMessage, partialToolResult]}
        chatSessionId="session-1"
        chatStatus="sending_response"
      />
    );

    expect(screen.getByText('GitHub device login required')).toBeTruthy();
    expect(screen.getByText('Timeout in 14:30')).toBeTruthy();
    expect(screen.getByText('gh auth login -h github.com -p https -w')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Device Code' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('81ED-AB39');
    expect(mockShowToast).toHaveBeenCalledWith('Device code copied', 'success');

    fireEvent.click(screen.getByRole('button', { name: 'Open Link' }));
    expect(openSpy).toHaveBeenCalledWith('https://github.com/login/device', '_blank', 'noopener,noreferrer');
  });

  it('auto-hides the timeline auth card when the timeout expires', () => {
    const assistantMessage: Message = {
      id: 'assistant-1',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: true,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: JSON.stringify({
              command: 'gh auth login -h github.com -p https -w',
              cwd: '/tmp/session',
              shell: 'zsh'
            })
          }
        }
      ]
    };

    const partialToolResult: Message = {
      id: 'tool-call-1',
      role: 'tool',
      name: 'execute_command',
      tool_call_id: 'tool-call-1',
      streamingComplete: false,
      timestamp: Date.now(),
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
            startedAt: Date.now() - 30_000,
          }
        })
      }]
    };

    render(
      <ChatContainer
        messages={[assistantMessage]}
        allMessages={[assistantMessage, partialToolResult]}
        chatSessionId="session-1"
        chatStatus="sending_response"
      />
    );

    expect(screen.getByText('GitHub device login required')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(14 * 60 * 1000 + 30 * 1000);
    });

    expect(screen.queryByText('GitHub device login required')).toBeNull();
  });

  it('cancels the active auth command and hides the card immediately', async () => {
    const assistantMessage: Message = {
      id: 'assistant-1',
      role: 'assistant',
      timestamp: Date.now(),
      streamingComplete: true,
      content: [{ type: 'text', text: '' }],
      tool_calls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'execute_command',
            arguments: JSON.stringify({
              command: 'gh auth login',
              cwd: '/tmp/session',
              shell: 'zsh'
            })
          }
        }
      ]
    };

    const partialToolResult: Message = {
      id: 'tool-call-1',
      role: 'tool',
      name: 'execute_command',
      tool_call_id: 'tool-call-1',
      streamingComplete: false,
      timestamp: Date.now(),
      content: [{
        type: 'text',
        text: JSON.stringify({
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: false,
          durationMs: 1820,
          cwd: '/tmp/session',
          shell: 'zsh',
          interactiveAuth: {
            commandFamily: 'gh-auth-login',
            deviceCode: '89FD-616E',
            verificationUri: 'https://github.com/login/device',
            timeoutMs: 900_000,
            startedAt: Date.now() - 30_000,
          }
        })
      }]
    };

    render(
      <ChatContainer
        messages={[assistantMessage]}
        allMessages={[assistantMessage, partialToolResult]}
        chatSessionId="session-1"
        chatStatus="sending_response"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(cancelActiveToolExecution).toHaveBeenCalledWith('session-1');

    expect(screen.queryByText('GitHub device login required')).toBeNull();
  });
});