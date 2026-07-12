/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';
import type { SubAgentTaskViewStatus } from '@shared/types/subAgentStreamingTypes';

// ── Controllable sub-agent task hook ──
interface TaskState {
  messages: Message[];
  status: SubAgentTaskViewStatus | undefined;
  loading: boolean;
  error: string | null;
}
let taskState: TaskState;

vi.mock('../../../lib/subAgent/useSubAgentTask', () => ({
  useSubAgentTask: () => taskState,
}));

// The main chat session must stay empty: a correct "completed" icon can then only
// come from the sub-agent messages provided through ToolCallsMessagesContext,
// proving the section no longer reads the wrong (main chat) message source.
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => [] as Message[],
  extractFilePathsFromText: () => [],
  ChatStatus: undefined,
  CachedFilePath: undefined,
}));

// Heavy ChatRenderItem leaves we don't exercise (the real ToolCallsSection is kept).
vi.mock('../message/Message', () => ({
  default: ({ message }: { message: Message }) => (
    <div data-testid="message-component">{(message as { id: string }).id}</div>
  ),
}));
vi.mock('../ChatInput', () => ({ default: () => <div data-testid="chat-input" /> }));
vi.mock('../message/GeneratedFileCards', () => ({ PresentedFile: undefined }));
vi.mock('../InteractiveRequestCard', () => ({ default: () => <div /> }));
vi.mock('../InteractiveAuthCard', () => ({ default: () => <div /> }));
vi.mock('@renderer/lib/utilities/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import SubAgentTaskDetailView from '../SubAgentTaskDetailView';

function assistantWithTool(): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content: [],
    tool_calls: [
      { id: 'call_dt', type: 'function', function: { name: 'get_current_datetime', arguments: '{}' } },
    ],
    timestamp: Date.now(),
  } as Message;
}

function completedToolResult(): Message {
  return {
    id: 'r1',
    role: 'tool',
    content: [{ type: 'text', text: '{}' }],
    tool_call_id: 'call_dt',
    name: 'get_current_datetime',
    streamingComplete: true,
    timestamp: Date.now(),
  } as Message;
}

function userMessage(): Message {
  return {
    id: 'u1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    timestamp: Date.now(),
  } as Message;
}

describe('SubAgentTaskDetailView tool icon rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskState = { messages: [], status: undefined, loading: false, error: null };
  });

  it('shows a loading state', () => {
    taskState = { messages: [], status: undefined, loading: true, error: null };
    render(<SubAgentTaskDetailView taskId="t1" />);
    expect(screen.getByText('Loading task...')).toBeTruthy();
  });

  it('shows an error state', () => {
    taskState = { messages: [], status: 'failed', loading: false, error: 'boom' };
    render(<SubAgentTaskDetailView taskId="t1" />);
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('renders the completed icon for a finished tool (regression for the always-alert bug)', () => {
    taskState = {
      messages: [assistantWithTool(), completedToolResult()],
      status: 'completed',
      loading: false,
      error: null,
    };
    const { container } = render(<SubAgentTaskDetailView taskId="t1" />);

    expect(container.querySelector('.tool-status-icon.completed')).toBeTruthy();
    // Previously this always rendered the interrupted (alert) icon.
    expect(container.querySelector('.tool-status-icon.interrupted')).toBeNull();
  });

  it('renders the executing spinner while the task is running with an unfinished tool', () => {
    taskState = {
      messages: [assistantWithTool()],
      status: 'running',
      loading: false,
      error: null,
    };
    const { container } = render(<SubAgentTaskDetailView taskId="t1" />);

    expect(container.querySelector('.tool-status-icon.executing')).toBeTruthy();
    expect(container.querySelector('.tool-status-icon.interrupted')).toBeNull();
    // Running task shows the typing indicator.
    expect(container.querySelector('.typing-indicator')).toBeTruthy();
  });

  it('shows the empty state while running with no messages', () => {
    taskState = { messages: [], status: 'running', loading: false, error: null };
    const { container } = render(<SubAgentTaskDetailView taskId="t1" />);

    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(container.querySelector('.typing-indicator')).toBeNull();
  });

  it('handles a running task whose latest message is not an assistant', () => {
    taskState = { messages: [userMessage()], status: 'running', loading: false, error: null };
    render(<SubAgentTaskDetailView taskId="t1" />);

    expect(screen.getByTestId('message-component')).toBeTruthy();
  });
});
