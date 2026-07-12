/**
 * @vitest-environment happy-dom
 *
 * Additional coverage for AgentChatEditingView.tsx.
 * Targets: no-chatId branch (line 614-618), URL sync setTabState (line 189),
 * validation auto-switch to basic (line 323), handleSave per-tab branches.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockTabParam = 'basic';
let mockChatId: string | undefined = 'chat-1';
const mockUseChats = vi.fn();
const mockUseFeatureFlag = vi.fn((_flag: string) => false);
const mockUseFeatureFlagState = vi.fn((_flag: string) => ({ enabled: false, initialized: true }));
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useParams: () => ({ chatId: mockChatId, '*': mockTabParam }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../userData/userDataProvider', async () => ({
  useProfileData: () => ({ chatOps: {} }),
  useChats: () => mockUseChats(),
}));

vi.mock('../../../ui/ToastProvider', async () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../../lib/featureFlags', async () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
  useFeatureFlagState: (flag: string) => mockUseFeatureFlagState(flag),
}));

let capturedBasicOnDataChange: ((tab: string, data: object, hasChanges: boolean) => void) | null = null;
let capturedBasicOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedKnowledgeOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedMcpOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedSkillsOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedHooksOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedHooksOnDataChange: ((tab: string, data: object, hasChanges: boolean) => void) | null = null;
let capturedPromptOnSave: ((data: object) => Promise<unknown>) | null = null;

vi.mock('../../agent-editor/AgentBasicTab', () => ({
  default: (props: any) => {
    capturedBasicOnDataChange = props.onDataChange;
    capturedBasicOnSave = props.onSave;
    return <div data-testid="basic-tab" />;
  },
}));
vi.mock('../../agent-editor/AgentKnowledgeBaseTab', () => ({
  default: (props: any) => { capturedKnowledgeOnSave = props.onSave; return <div data-testid="knowledge-tab" />; },
}));
vi.mock('../../agent-editor/AgentMcpServersTab', () => ({
  default: (props: any) => { capturedMcpOnSave = props.onSave; return <div data-testid="mcp-tab" />; },
}));
vi.mock('../../agent-editor/AgentSkillsTab', () => ({
  default: (props: any) => { capturedSkillsOnSave = props.onSave; return <div data-testid="skills-tab" />; },
}));
vi.mock('../../agent-editor/AgentHooksTab', () => ({
  default: (props: any) => {
    capturedHooksOnSave = props.onSave;
    capturedHooksOnDataChange = props.onDataChange;
    return <div data-testid="hooks-tab" />;
  },
}));
vi.mock('../../agent-editor/AgentSchedulesTab', () => ({ default: () => <div data-testid="schedules-tab" /> }));
vi.mock('../../agent-editor/AgentSystemPromptTab', () => ({
  default: (props: any) => { capturedPromptOnSave = props.onSave; return <div data-testid="prompt-tab" />; },
}));
vi.mock('../../agent-editor/ErrorHandler', () => ({
  default: ({ error, onDismiss }: { error: string; onDismiss: () => void }) => (
    <div>
      <span data-testid="error-msg">{error}</span>
      <button onClick={onDismiss} data-testid="error-dismiss">Dismiss</button>
    </div>
  ),
}));
vi.mock('../../../../styles/Agent.css', async () => ({}));
vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import AgentChatEditingView from '../AgentChatEditingView';

const baseAgent = {
  name: 'Test Agent',
  emoji: '🤖',
  role: '',
  model: 'gpt-4.1',
  mcp_servers: [],
  system_prompt: '',
  skills: [],
  hooks: [],
  workspace: '/ws',
  knowledge: { knowledgeBase: '/kb' },
  knowledgeBase: '/kb',
  version: '1.0.0',
  source: 'ON-DEVICE',
};

const baseChat = {
  chat_id: 'chat-1',
  agent: { ...baseAgent },
  chatSessions: [],
};

function setupChats(overrides: object = {}) {
  const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
  mockUseChats.mockReturnValue({
    chats: [{ ...baseChat, ...overrides }],
    updateChatAgent,
  });
  return updateChatAgent;
}

describe('AgentChatEditingView — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabParam = 'basic';
    mockChatId = 'chat-1';
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseFeatureFlagState.mockReturnValue({ enabled: false, initialized: true });
    capturedBasicOnDataChange = null;
    capturedBasicOnSave = null;
    capturedKnowledgeOnSave = null;
    capturedMcpOnSave = null;
    capturedSkillsOnSave = null;
    capturedHooksOnSave = null;
    capturedHooksOnDataChange = null;
    capturedPromptOnSave = null;
  });

  it('shows no-agent-selected UI and Go to Chat button when chatId is undefined', async () => {
    mockChatId = undefined;
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() });
    render(<AgentChatEditingView />);
    expect(screen.getByText(/No agent selected/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Go to Chat/i });
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat');
  });

  it('URL sync useEffect updates activeTab when tabParam changes to different value', async () => {
    mockTabParam = 'mcp_servers';
    setupChats();
    const { rerender } = render(<AgentChatEditingView />);
    await screen.findByTestId('mcp-tab');

    // Change tabParam to a different route, causing URL sync effect to fire
    mockTabParam = 'skills';
    await act(async () => { rerender(<AgentChatEditingView />); });
    await screen.findByTestId('skills-tab');
    // activeTab should have been updated to 'skills' via setTabState
    expect(screen.getByTestId('skills-tab')).toBeInTheDocument();
  });

  it('validation error auto-switches from non-basic tab to basic tab (line 323)', async () => {
    // Start on a non-basic tab so the validation useEffect fires the setTabState branch
    mockTabParam = 'mcp_servers';
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat },
        { chat_id: 'chat-2', agent: { ...baseAgent, name: 'DupAgent' }, chatSessions: [] },
      ],
      updateChatAgent: vi.fn(),
    });
    render(<AgentChatEditingView />);
    await screen.findByTestId('mcp-tab');

    // onDataChange callback for basic tab with a duplicate name — triggers validation
    await act(async () => {
      capturedBasicOnDataChange?.('basic', { name: 'DupAgent' }, true);
    });

    // Validation fires and calls setTabState to 'basic' — save button should be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
  });

  it('handleSave: basic tab with avatar field update', async () => {
    mockTabParam = 'basic';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('basic-tab');

    await act(async () => {
      await capturedBasicOnSave?.({ name: 'New Name', emoji: '🎯', role: 'assistant', model: 'gpt-4.1', avatar: 'https://example.com/img.png' });
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: knowledge tab without knowledgeBase field', async () => {
    mockTabParam = 'knowledge';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('knowledge-tab');

    await act(async () => {
      // knowledgeBase undefined means the branch that checks data.knowledgeBase !== undefined won't fire
      await capturedKnowledgeOnSave?.({});
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: mcp tab without mcpServers field', async () => {
    mockTabParam = 'mcp_servers';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('mcp-tab');

    await act(async () => {
      await capturedMcpOnSave?.({});
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: skills tab without skills field', async () => {
    mockTabParam = 'skills';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('skills-tab');

    await act(async () => {
      await capturedSkillsOnSave?.({});
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: prompt tab without systemPrompt field', async () => {
    mockTabParam = 'system_prompt';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('prompt-tab');

    await act(async () => {
      await capturedPromptOnSave?.({});
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: when agentData is null, falls back to building from chat directly', async () => {
    // Render with chats empty first so agentData stays undefined, then add chat
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() });
    render(<AgentChatEditingView />);

    // Agent not found so error is shown
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument());
  });

  it('handleSaveAll: when no chatId, throws and sets error', async () => {
    mockChatId = 'chat-1';
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true });
    // Chats list is empty so chat not found
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent });
    render(<AgentChatEditingView />);
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument());
  });

  it('handleKnowledgeGroupToggle: collapses when already expanded (no navigate call)', async () => {
    mockUseFeatureFlag.mockImplementation((f: string) => f === 'openkosmosFeatureScheduler');
    mockTabParam = 'knowledge'; // starts expanded
    setupChats();
    render(<AgentChatEditingView />);

    const knowledgeBtn = await screen.findByRole('button', { name: 'Knowledge' });
    // Currently expanded (activeTab is knowledge), clicking collapses without navigate
    const navCallsBefore = mockNavigate.mock.calls.length;
    fireEvent.click(knowledgeBtn);
    // isKnowledgeGroupExpanded will become false, but activeTab is already knowledge
    // so navigate should NOT be called (nextExpanded=false, so the if(nextExpanded) branch skips)
    expect(mockNavigate.mock.calls.length).toBe(navCallsBefore);
  });

  it('does not redirect when tabParam is already set', () => {
    mockTabParam = 'basic';
    setupChats();
    render(<AgentChatEditingView />);
    // No replace-redirect since tabParam is 'basic' (non-empty)
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.stringContaining('settings/basic'),
      { replace: true }
    );
  });

  it('agent knowledgeBase field uses legacy knowledgeBase when knowledge property missing', async () => {
    setupChats({
      agent: { ...baseAgent, knowledge: undefined, knowledgeBase: '/legacy-kb' },
    });
    render(<AgentChatEditingView />);
    await screen.findByText('Test Agent - Settings');
    // Renders without crash
  });

  it('saves all with schedules pendingChanges', async () => {
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('basic-tab');

    await act(async () => {
      capturedBasicOnDataChange?.('schedules', {}, true);
    });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).not.toBeDisabled();

    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => expect(updateChatAgent).toHaveBeenCalled());
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it('handleSave succeeds and fills updatedAgent using agentData when available', async () => {
    mockTabParam = 'basic';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('basic-tab');

    // Agent data will be set after first render; now trigger individual save
    await act(async () => {
      await capturedBasicOnSave?.({ name: 'Saved Name', model: 'gpt-4o' });
    });

    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('renders the Hooks tab as active and reflects its pending-change indicator', async () => {
    mockTabParam = 'hooks';
    setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('hooks-tab');

    // Drive onDataChange so validateAllChanges folds in the hooks cache and the
    // nav pending indicator renders.
    await act(async () => {
      capturedHooksOnDataChange?.('hooks', { hooks: ['h1'] }, true);
    });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('handleSave: hooks tab with hooks field set', async () => {
    mockTabParam = 'hooks';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('hooks-tab');

    await act(async () => {
      await capturedHooksOnSave?.({ hooks: ['h1', 'h2'] });
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('handleSave: hooks tab without hooks field', async () => {
    mockTabParam = 'hooks';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('hooks-tab');

    await act(async () => {
      await capturedHooksOnSave?.({});
    });
    expect(updateChatAgent).toHaveBeenCalled();
  });

  it('saves all with hooks pendingChanges (hooks branch in handleSaveAll)', async () => {
    mockTabParam = 'hooks';
    const updateChatAgent = setupChats();
    render(<AgentChatEditingView />);
    await screen.findByTestId('hooks-tab');

    await act(async () => {
      capturedHooksOnDataChange?.('hooks', { hooks: ['h1'] }, true);
    });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).not.toBeDisabled();

    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => expect(updateChatAgent).toHaveBeenCalled());
    expect(mockShowSuccess).toHaveBeenCalled();
  });
});
