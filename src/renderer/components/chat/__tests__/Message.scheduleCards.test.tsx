/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@shared/types/chatTypes';

import MessageComponent from '../message/Message';

const mockNavigate = vi.fn();
const mockListJobs = vi.fn();
const mockRunJobNow = vi.fn();
const mockShowToast = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('react-syntax-highlighter', async () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', async () => ({
  oneDark: {},
}));

vi.mock('../../../styles/Message.css', async () => ({}));
vi.mock('../../../styles/markdown-render.css', async () => ({}));

vi.mock('../../streaming/StreamingV2Message', async () => ({
  StreamingV2Message: ({ message }: { message: Message }) => (
    <div data-testid="streaming-v2-message">
      {message.content.find((part) => part.type === 'text' && 'text' in part)?.text}
    </div>
  ),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: mockShowToast,
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../../lib/featureFlags', async () => ({
  useFeatureFlag: () => false,
}));

const mockEffectiveShow = vi.fn();
vi.mock('../chat-side.atom', async () => ({
  ScheduleSidepaneAtom: {
    useChange: () => ({
      effectiveShow: mockEffectiveShow,
      hide: vi.fn(),
      show: vi.fn(),
      effectiveToggle: vi.fn(),
    }),
    useData: () => false,
  },
  WorkspaceExplorerAtom: {
    useChange: () => ({ setVisible: vi.fn(), effectiveToggle: vi.fn(), effectiveReveal: vi.fn() }),
    useData: () => ({ visible: false }),
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatId: () => 'chat-fallback',
}));

vi.mock('../message/GeneratedFileCards', async () => ({
  __esModule: true,
  default: () => null,
  normalizePresentedFilesToGeneratedFileItems: vi.fn(() => []),
}));

vi.mock('../../../ipc/scheduler', async () => ({
  schedulerApi: {
    listJobs: () => mockListJobs(),
    runJobNow: (...args: unknown[]) => mockRunJobNow(...args),
  },
}));

vi.mock('../../../lib/scheduler/cronDescriptions', async () => ({
  describeCronExpression: vi.fn(() => 'Weekdays at 09:00'),
}));

vi.mock('../message/SayHiActionItems', async () => ({
  __esModule: true,
  default: () => null,
  parseSayHiContent: vi.fn((content: string) => ({
    markdownBody: content,
    actionItemGroups: [],
  })),
}));

vi.mock('../message/PmProjectSayHiCards', async () => ({
  __esModule: true,
  default: () => null,
  parsePmSayHiCards: vi.fn(() => null),
}));

vi.mock('../message/PmAgentSayHiCards', async () => ({
  __esModule: true,
  default: () => null,
  parsePmAgentSayHiMessage: vi.fn(() => null),
}));

describe('Message schedule cards', () => {
  const scheduleId = 'sched_20260403214625_b262cf37-84d1-4ebf-b1ab-aa05d6712768_6dsl1ydrr';

  const message: Message = {
    id: 'assistant-schedule-card',
    role: 'assistant',
    timestamp: Date.now(),
    streamingComplete: true,
    content: [
      {
        type: 'text',
        text: `All set. Job ID: ${scheduleId}`,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListJobs.mockResolvedValue({
      success: true,
      data: [
        {
          id: scheduleId,
          name: 'Catch up - Journeys',
          description: 'Scheduled morning briefing',
          scheduleType: 'cron',
          cronExpression: '0 9 * * 1-5',
          enabled: true,
          agentId: 'chat-123',
          message: 'Summarize the latest updates.',
          status: 'pending',
        },
      ],
    });
    mockRunJobNow.mockResolvedValue({ success: true, data: { chatSessionId: 'session-1' } });
  });

  it('renders a schedule card when the assistant response contains a schedule id', async () => {
    render(
      <MessageComponent
        message={message}
        isStreaming={false}
      />,
    );

    expect(await screen.findByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Catch up - Journeys')).toBeInTheDocument();
    expect(screen.getByText('Weekdays at 09:00')).toBeInTheDocument();
    expect(screen.getByText(scheduleId)).toBeInTheDocument();
  });

  it('runs the schedule from the card and shows an open-session action toast', async () => {
    render(
      <MessageComponent
        message={message}
        isStreaming={false}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));

    await waitFor(() => {
      expect(mockRunJobNow).toHaveBeenCalledWith(scheduleId);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Scheduled run started.',
        'success',
        undefined,
        expect.objectContaining({
          persistent: true,
          actions: [
            expect.objectContaining({
              label: 'Open schedule run',
              variant: 'primary',
            }),
          ],
        }),
      );
      expect(mockEffectiveShow).toHaveBeenCalled();
    });

    const toastOptions = mockShowToast.mock.calls[0][3];
    toastOptions.actions[0].onClick();

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-123/session-1', {
      state: {
        intent: 'open-session',
        source: 'schedule-run-toast',
        targetChatId: 'chat-123',
        targetSessionId: 'session-1',
        openSchedulesSidepane: true,
      },
    });

  });

  it('falls back to a plain success toast when the run result has no chat session id', async () => {
    mockRunJobNow.mockResolvedValueOnce({ success: true, data: {} });

    render(
      <MessageComponent
        message={message}
        isStreaming={false}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Scheduled run started.');
    });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('navigates to the agent schedules tab from the manage button', async () => {
    render(
      <MessageComponent
        message={message}
        isStreaming={false}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-fallback/settings/schedules');
  });

  it('uses the current chat id even when chatStatus chatId is unavailable', async () => {
    render(
      <MessageComponent
        message={message}
        isStreaming={false}
      />,
    );

    const manageButton = await screen.findByRole('button', { name: 'Manage' });
    expect(manageButton).not.toBeDisabled();

    fireEvent.click(manageButton);

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-fallback/settings/schedules');
  });
});