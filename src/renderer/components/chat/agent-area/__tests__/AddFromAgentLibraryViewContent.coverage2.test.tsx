// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * Coverage2 tests for AddFromAgentLibraryViewContent.tsx.
 * Focuses on branches not covered in coverage.test.tsx:
 * - selectAgent URL param (agent found / not found)
 * - requirements check rendering (software/mcp/skill rows, checking state, satisfied/unsatisfied)
 * - overwrite dialog: No / Continue flows
 * - confirm dialog: No / Let Kobi Fix & Install flows
 * - install error paths (duplicate agent, failed result)
 * - update mode button rendering
 * - installed version display
 * - empty agents list / configuration section / contact section
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

// ---- mock variables ----

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockNavigate = vi.fn();
const mockStartNewChatFor = vi.fn();
const mockSendUserMessageOptimistically = vi.fn();
const mockParseUserInputPlaceholders = vi.fn().mockResolvedValue({ hasUserInputFields: false, fields: [] });
const mockApplyUserInputsToEnv = vi.fn((env: any) => env);
const mockHasOpenKosmosPlaceholdersInObject = vi.fn().mockReturnValue(false);
const mockReplaceOpenKosmosPlaceholders = vi.fn((obj: any) => Promise.resolve(obj));
const mockAddChatConfig = vi.fn();
const mockUpdateChatConfig = vi.fn();

// URL search params mock
let mockSearchParamsMap: URLSearchParams = new URLSearchParams();

// ---- vi.mock calls ----

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParamsMap],
}));

vi.mock('react-markdown', () => ({
  default: function MockReactMarkdown({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));

vi.mock('../../../../styles/Modal.css', () => ({}));
vi.mock('../../../../styles/McpLibraryView.css', () => ({}));

vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showToast: vi.fn(),
  }),
}));

const mockUseMCPServers = vi.fn();
const mockUseSkills = vi.fn();
const mockUseProfileData = vi.fn();

vi.mock('../../../userData/userDataProvider', () => ({
  useMCPServers: (...args: unknown[]) => mockUseMCPServers(...args),
  useSkills: (...args: unknown[]) => mockUseSkills(...args),
  useProfileData: (...args: unknown[]) => mockUseProfileData(...args),
}));

vi.mock('../../../../lib/chat/chatOps', () => ({
  chatOps: {
    addChatConfig: (...args: any[]) => mockAddChatConfig(...args),
    updateChatConfig: (...args: any[]) => mockUpdateChatConfig(...args),
  },
}));

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(),
  }),
}));

const { mockProfileDataManager } = vi.hoisted(() => ({
  mockProfileDataManager: {
    getCurrentUserAlias: vi.fn().mockReturnValue('test-user'),
    getCache: vi.fn(),
  },
}));

vi.mock('../../../../lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {},
}));

vi.mock('../../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: { streamMessage: vi.fn() },
}));

vi.mock('../../../../lib/chat/startNewChatFor', () => ({
  startNewChatFor: (...args: any[]) => mockStartNewChatFor(...args),
}));

vi.mock('../../../../lib/chat/sendUserMessageOptimistically', () => ({
  sendUserMessageOptimistically: (...args: any[]) => mockSendUserMessageOptimistically(...args),
}));

vi.mock('../../../../lib/utilities/processUserInputPlaceholder', () => ({
  parseUserInputPlaceholders: (...args: any[]) => mockParseUserInputPlaceholders(...args),
  applyUserInputsToEnv: (...args: any[]) => mockApplyUserInputsToEnv(...args),
}));

vi.mock('../../../../lib/utilities/openkosmosPlaceholderParser', () => ({
  hasOpenKosmosPlaceholdersInObject: (...args: any[]) => mockHasOpenKosmosPlaceholdersInObject(...args),
  replaceOpenKosmosPlaceholders: (...args: any[]) => mockReplaceOpenKosmosPlaceholders(...args),
}));

vi.mock('../../../../lib/mcp/mcpOps', () => ({
  McpOps: { reconnect: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('../../../../lib/utils/urlUtils', () => ({
  appendCacheBustingTimestamp: (url: string) => url + '?t=123',
}));

vi.mock('../../../ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../../mcp/UserInputModal', () => ({
  default: ({ isOpen, onClose, onSubmit, onSkip, serverName }: any) =>
    isOpen ? (
      <div data-testid="user-input-modal">
        <span>{serverName}</span>
        <button onClick={onClose} data-testid="modal-close">Close</button>
        <button onClick={() => onSubmit({})} data-testid="modal-submit">Submit</button>
        <button onClick={onSkip} data-testid="modal-skip">Skip</button>
      </div>
    ) : null,
}));

// ---- import component ----

import AddFromAgentLibraryViewContent from '../AddFromAgentLibraryViewContent';

// ---- helpers ----

function makeAgent(overrides: Partial<any> = {}) {
  return {
    name: 'TestAgent',
    version: '1.0.0',
    source: 'IN-LIBRARY' as const,
    description: 'A test agent',
    configuration: {
      emoji: '🤖',
      name: 'TestAgent',
      model: 'gpt-4',
      system_prompt: 'You are helpful',
      mcp_servers: [],
      skills: [],
    },
    prompts: {
      setup_agent: 'https://cdn.example.com/setup_agent.md',
      update_agent: 'https://cdn.example.com/update_agent.md',
      setup_requirements: 'https://cdn.example.com/setup_requirements.md',
    },
    ...overrides,
  };
}

function makeLibraryData(agents = [makeAgent()]) {
  return { agents };
}

const DEFAULT_LIBRARY_DATA = { agents: [makeAgent()] };

function setupDefaultMocks(libraryData = DEFAULT_LIBRARY_DATA) {
  mockUseMCPServers.mockReturnValue({ servers: [], isLoading: false });
  mockUseSkills.mockReturnValue({ skills: [] });
  mockUseProfileData.mockReturnValue({ chats: [] });
  mockParseUserInputPlaceholders.mockResolvedValue({ hasUserInputFields: false, fields: [] });
  mockAddChatConfig.mockResolvedValue({ success: true, data: { chat_id: 'new-chat-id' } });
  mockUpdateChatConfig.mockResolvedValue({ success: true });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(libraryData),
  });
}

function mockFetch(data: any) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

// ---- tests ----

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsMap = new URLSearchParams();
  setupDefaultMocks(DEFAULT_LIBRARY_DATA);
  (window as any).electronAPI = {
    builtinTools: {
      execute: vi.fn().mockResolvedValue({ success: true, data: JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }) }),
    },
    mcpLibrary: {
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
    },
    skillLibrary: {
      addSkill: vi.fn().mockResolvedValue({ success: true }),
    },
    openkosmos: {
      replacePlaceholders: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },
  };
});

// ---- Test Suites ----

describe('AddFromAgentLibraryViewContent - selectAgent URL param', () => {
  it('auto-selects agent found by name from URL param', async () => {
    const agent1 = makeAgent({ name: 'AgentAlpha' });
    const agent2 = makeAgent({ name: 'AgentBeta' });
    setupDefaultMocks({ agents: [agent1, agent2] });
    mockSearchParamsMap = new URLSearchParams({ selectAgent: 'AgentBeta' });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getAllByText('AgentBeta'));

    expect(screen.getAllByText('AgentBeta').length).toBeGreaterThan(0);
  });

  it('falls back to first agent when URL param agent not found', async () => {
    const agent1 = makeAgent({ name: 'AgentAlpha' });
    setupDefaultMocks({ agents: [agent1] });
    mockSearchParamsMap = new URLSearchParams({ selectAgent: 'NonExistentAgent' });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getAllByText('AgentAlpha'));

    expect(screen.getAllByText('AgentAlpha').length).toBeGreaterThan(0);
  });
});

describe('AddFromAgentLibraryViewContent - empty agents list', () => {
  it('shows empty state when agents list is empty', async () => {
    setupDefaultMocks({ agents: [] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/No agents available/i));

    expect(screen.getByText(/No agents available/i)).toBeTruthy();
  });
});

describe('AddFromAgentLibraryViewContent - agent with requirements', () => {
  it('shows requirements checking state then resolves mcp requirement', async () => {
    const agent = makeAgent({
      requirements: {
        mcp: ['my-mcp-server'],
      },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'my-mcp-server', status: 'connected' }],
      isLoading: false,
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/Requirements/i));

    expect(screen.getByText('my-mcp-server')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows skill requirement as not installed', async () => {
    const agent = makeAgent({
      requirements: { skills: ['my-skill'] },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseSkills.mockReturnValue({ skills: [] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('my-skill'));

    expect(screen.getByText('Not installed')).toBeTruthy();
  });

  it('shows skill requirement as installed when skill exists', async () => {
    const agent = makeAgent({
      requirements: { skills: ['my-skill'] },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseSkills.mockReturnValue({ skills: [{ name: 'my-skill' }] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('my-skill'));

    expect(screen.getByText('Installed')).toBeTruthy();
  });

  it('shows warning section when requirements are unsatisfied', async () => {
    const agent = makeAgent({
      requirements: { skills: ['missing-skill'] },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseSkills.mockReturnValue({ skills: [] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/may not work correctly/i));

    expect(screen.getByText(/may not work correctly/i)).toBeTruthy();
  });

  it('shows Fix Requirements button when requirements are unsatisfied', async () => {
    const agent = makeAgent({
      requirements: { skills: ['missing-skill'] },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseSkills.mockReturnValue({ skills: [] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/Fix Requirements/i));

    expect(screen.getByText(/Fix Requirements/i)).toBeTruthy();
  });
});

describe('AddFromAgentLibraryViewContent - install flow', () => {
  it('shows Installed badge for already installed IN-LIBRARY agent', async () => {
    const agent = makeAgent({ name: 'InstalledAgent', version: '1.0.0' });
    setupDefaultMocks({ agents: [agent] });
    mockUseProfileData.mockReturnValue({
      chats: [{
        chat_id: 'chat-1',
        agent: { name: 'InstalledAgent', source: 'IN-LIBRARY', version: '1.0.0' },
      }],
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getAllByText('Installed'));

    expect(screen.getAllByText('Installed').length).toBeGreaterThan(0);
  });

  it('shows Update button when library version is newer', async () => {
    const agent = makeAgent({ name: 'UpgradableAgent', version: '2.0.0' });
    setupDefaultMocks({ agents: [agent] });
    mockUseProfileData.mockReturnValue({
      chats: [{
        chat_id: 'chat-1',
        agent: { name: 'UpgradableAgent', source: 'IN-LIBRARY', version: '1.0.0' },
      }],
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getAllByText('Update'));

    expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
  });

  it('shows installed version in version section', async () => {
    const agent = makeAgent({ name: 'TestAgent', version: '2.0.0' });
    setupDefaultMocks({ agents: [agent] });
    mockUseProfileData.mockReturnValue({
      chats: [{
        chat_id: 'chat-1',
        agent: { name: 'TestAgent', source: 'IN-LIBRARY', version: '1.5.0' },
      }],
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/Installed Version/i));

    expect(screen.getByText(/1.5.0/)).toBeTruthy();
  });

  it('installs agent successfully without requirements', async () => {
    const agent = makeAgent({ name: 'FreshAgent' });
    setupDefaultMocks({ agents: [agent] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => expect(mockAddChatConfig).toHaveBeenCalled());
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('installed'));
  });

  it('shows overwrite dialog when ON-DEVICE agent exists', async () => {
    const agent = makeAgent({ name: 'DupeAgent' });
    setupDefaultMocks({ agents: [agent] });
    mockUseProfileData.mockReturnValue({
      chats: [{
        chat_id: 'chat-1',
        agent: { name: 'DupeAgent', source: 'ON-DEVICE' },
      }],
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => screen.getByText(/Replace Existing Agent/i));
    expect(screen.getByText(/Replace Existing Agent/i)).toBeTruthy();
  });
});

describe('AddFromAgentLibraryViewContent - overwrite dialog', () => {
  async function setupWithOnDeviceAgent() {
    const agent = makeAgent({ name: 'OverwriteAgent' });
    setupDefaultMocks({ agents: [agent] });
    mockUseProfileData.mockReturnValue({
      chats: [{
        chat_id: 'chat-1',
        agent: { name: 'OverwriteAgent', source: 'ON-DEVICE' },
      }],
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => screen.getByText(/Replace Existing Agent/i));
  }

  it('closes overwrite dialog when No is clicked', async () => {
    await setupWithOnDeviceAgent();

    const noBtn = screen.getByRole('button', { name: /No/i });
    await act(async () => { fireEvent.click(noBtn); });

    await waitFor(() => expect(screen.queryByText(/Replace Existing Agent/i)).toBeNull());
  });

  it('proceeds with install when Continue is clicked in overwrite dialog', async () => {
    await setupWithOnDeviceAgent();
    mockAddChatConfig.mockResolvedValue({ success: true, data: { chat_id: 'new-id' } });

    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    await act(async () => { fireEvent.click(continueBtn); });

    await waitFor(() => expect(mockUpdateChatConfig).toHaveBeenCalled());
  });
});

describe('AddFromAgentLibraryViewContent - confirm dialog (missing requirements)', () => {
  it('clicking Fix Requirements when only skill unsatisfied directly installs from library', async () => {
    const agent = makeAgent({
      name: 'SkillAgent',
      requirements: { skills: ['missing-skill'] },
    });
    setupDefaultMocks({ agents: [agent] });
    mockUseSkills.mockReturnValue({ skills: [] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/Fix Requirements/i));

    const fixBtn = screen.getByText(/Fix Requirements/i);
    await act(async () => { fireEvent.click(fixBtn); });

    await waitFor(() => expect((window as any).electronAPI.skillLibrary.addSkill).toHaveBeenCalledWith('missing-skill'));
  });
});

describe('AddFromAgentLibraryViewContent - contact section', () => {
  it('displays contact link when agent has contact', async () => {
    const agent = makeAgent({ contact: 'dev@example.com' });
    setupDefaultMocks({ agents: [agent] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('dev@example.com'));

    expect(screen.getByText('dev@example.com')).toBeTruthy();
  });
});

describe('AddFromAgentLibraryViewContent - agent selection', () => {
  it('switches selected agent when another is clicked', async () => {
    const agent1 = makeAgent({ name: 'AgentOne', description: 'First agent' });
    const agent2 = makeAgent({ name: 'AgentTwo', description: 'Second agent' });
    setupDefaultMocks({ agents: [agent1, agent2] });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('AgentTwo'));

    await act(async () => {
      fireEvent.click(screen.getByText('AgentTwo'));
    });

    await waitFor(() => screen.getAllByText('AgentTwo'));
    const headers = screen.getAllByText('AgentTwo');
    expect(headers.length).toBeGreaterThan(0);
  });
});

describe('AddFromAgentLibraryViewContent - retry on error', () => {
  it('shows Retry button and can retry after error', async () => {
    // First call fails, second succeeds
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(DEFAULT_LIBRARY_DATA),
      });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Retry'));

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await waitFor(() => screen.getAllByText('TestAgent'));
    expect(screen.getAllByText('TestAgent').length).toBeGreaterThan(0);
  });
});

describe('AddFromAgentLibraryViewContent - install fails', () => {
  it('shows error when addChatConfig returns failure', async () => {
    const agent = makeAgent({ name: 'FailAgent' });
    setupDefaultMocks({ agents: [agent] });
    mockAddChatConfig.mockResolvedValue({ success: false, error: 'DB error' });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('DB error')));
  });

  it('shows error when addChatConfig returns no chat_id', async () => {
    const agent = makeAgent({ name: 'NoChatIdAgent' });
    setupDefaultMocks({ agents: [agent] });
    mockAddChatConfig.mockResolvedValue({ success: true, data: {} });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('chat ID')));
  });
});

describe('AddFromAgentLibraryViewContent - Kobi not found error', () => {
  it('shows error when Kobi agent not found during Fix Requirements (software not satisfied)', async () => {
    const agent = makeAgent({
      name: 'TestAgent5',
      requirements: { software: { git: '2.0.0' } },
    });
    setupDefaultMocks({ agents: [agent] });
    // software check returns failure → software unsatisfied → Fix Requirements uses Kobi flow
    (window as any).electronAPI.builtinTools.execute = vi.fn().mockResolvedValue({
      success: true,
      data: JSON.stringify({ stdout: '', stderr: 'not found', exitCode: 1 }),
    });
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { chats: [] }, // no Kobi agent
    });

    render(<AddFromAgentLibraryViewContent />);
    await waitFor(() => screen.getByText(/Fix Requirements/i), { timeout: 3000 });

    const fixBtn = screen.getByText(/Fix Requirements/i);
    await act(async () => { fireEvent.click(fixBtn); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Kobi')), { timeout: 3000 });
  });
});
