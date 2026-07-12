/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentSchedulesTab from '../AgentSchedulesTab';
import type { AgentConfig, TabComponentProps } from '../types';

const i18nState = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'agent.schedules.enabledCount': '{count} enabled schedules',
    'agent.schedules.addNew': 'Add New Schedule',
    'agent.schedules.emptyTitle': 'No schedules configured',
    'agent.schedules.emptyDescription': 'Add one-time or recurring schedules.',
  };
  const makeTranslator = () => (key: string, params?: Record<string, unknown>) => {
    const template = messages[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
  };

  return {
    language: 'en',
    translators: {
      en: makeTranslator(),
      zh: makeTranslator(),
    },
  };
});

const schedulerMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  toggleJob: vi.fn(),
  deleteJob: vi.fn(),
  updateJob: vi.fn(),
  runJobNow: vi.fn(),
}));
const profileMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  getProfile: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../../../styles/Agent.css', () => ({}));
vi.mock('../../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
  }),
}));
vi.mock('../../../../ipc/scheduler', () => ({
  schedulerApi: {
    listJobs: schedulerMocks.listJobs,
    toggleJob: schedulerMocks.toggleJob,
    deleteJob: schedulerMocks.deleteJob,
    updateJob: schedulerMocks.updateJob,
    runJobNow: schedulerMocks.runJobNow,
  },
}));
vi.mock('../../../../lib/userData', () => ({
  profileDataManager: {
    subscribe: profileMocks.subscribe,
    getProfile: profileMocks.getProfile,
  },
}));
vi.mock('../../../../lib/scheduler/showScheduledRunStartedToast', () => ({
  showScheduledRunStartedToast: vi.fn(),
}));
vi.mock('@/lib/agent', () => ({
  resolveChatAgent: (chat: any) => chat.agent,
}));
vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => toastMocks,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon" />,
}));
vi.mock('../../../settings/SchedulesContentView', () => ({
  default: ({ jobs, error }: any) => (
    <div data-testid="schedules-content-view">
      {error ? <div data-testid="error-msg">{error}</div> : null}
      {jobs.map((job: any) => <span key={job.id}>{job.name}</span>)}
    </div>
  ),
  ScheduleWakeNotice: () => <div data-testid="schedule-wake-notice" />,
}));
vi.mock('../../../settings/ScheduleCleanupSection', () => ({
  ScheduleCleanupSection: () => <div data-testid="schedule-cleanup-section" />,
}));
vi.mock('../AddScheduleOverlay', () => ({
  default: ({ open }: any) => open ? <div data-testid="add-schedule-overlay" /> : null,
}));

function makeAgentData(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    emoji: 'A',
    role: 'assistant',
    model: 'gpt-4',
    mcpServers: [],
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentConfig;
}

function defaultProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    mode: 'update',
    chatId: 'agent-1',
    agentData: makeAgentData(),
    onSave: vi.fn(),
    readOnly: false,
    ...overrides,
  };
}

describe('AgentSchedulesTab i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    profileMocks.subscribe.mockReturnValue(() => {});
    profileMocks.getProfile.mockReturnValue({ chats: [{ chat_id: 'agent-1', agent: { name: 'Test Agent' } }] });
    schedulerMocks.listJobs.mockResolvedValue({ success: true, data: [] });
  });

  it('does not reload schedule data or close the add overlay when only language changes', async () => {
    const { rerender } = render(<AgentSchedulesTab {...defaultProps()} />);
    await waitFor(() => expect(screen.getAllByText('Add New Schedule')[0]).toBeInTheDocument());
    expect(schedulerMocks.listJobs).toHaveBeenCalledTimes(1);
    expect(profileMocks.subscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByText('Add New Schedule')[0]);
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument();

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<AgentSchedulesTab {...defaultProps()} />);
    });

    expect(schedulerMocks.listJobs).toHaveBeenCalledTimes(1);
    expect(profileMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument();
  });
});
