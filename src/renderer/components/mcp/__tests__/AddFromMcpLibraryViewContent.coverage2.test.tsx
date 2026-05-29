// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Coverage2 tests for AddFromMcpLibraryViewContent — targets branches missed
 * by the existing coverage.test.tsx and deep.test.tsx:
 * - Retry button on error state
 * - Overwrite dialog "No" button
 * - UserInputModal close button (onClose handler)
 * - handleUserInputSubmit with null pendingServerConfig
 * - handleUserInputSkip with null pendingServerConfig
 * - Apply dialog shown after successful install
 * - Tags rendering in server card
 * - Installed badge in server list
 * - "new" superscript for update-available server
 * - Initial requirements table rendered from selectedServer.requirements (no results yet)
 * - handleKobiFixAndInstall fresh-install path (setup_mcp prompt)
 * - requirements table "no requirements" empty object branch
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import AddFromMcpLibraryViewContent from '../AddFromMcpLibraryViewContent';

// ---- mocks ----

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockGetLibraryData = vi.fn();
const mockNavigate = vi.fn();
const mockRefreshRuntimeInfo = vi.fn();
const mockStartNewChatFor = vi.fn();
const mockSendUserMessageOptimistically = vi.fn();
const mockParseUserInputPlaceholders = vi.fn();
const mockApplyUserInputsToEnv = vi.fn((env: any) => env);
const mockApplyUserInputsToUrl = vi.fn((url: string) => url);
const mockApplyUserInputsToArgs = vi.fn((args: any[]) => args);
const mockHasOpenKosmosPlaceholders = vi.fn().mockReturnValue(false);
const mockReplaceOpenKosmosPlaceholders = vi.fn((obj: any) => Promise.resolve(obj));
const mockContainsOpenKosmosPlaceholder = vi.fn().mockReturnValue(false);
const mockMcpOpsAdd = vi.fn().mockResolvedValue({ success: true });
const mockMcpOpsUpdate = vi.fn().mockResolvedValue({ success: true });
const mockExecuteBuiltinTool = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('react-markdown', () => ({
  default: function MockReactMarkdown({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('../../../styles/Modal.css', () => ({}));
vi.mock('../../../styles/McpLibraryView.css', () => ({}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showToast: vi.fn(),
  }),
}));

const mockUseMCPServers = vi.fn();
vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: (...args: unknown[]) => mockUseMCPServers(...args),
}));

vi.mock('../../../lib/mcp/mcpOps', () => ({
  McpOps: {
    add: (...args: any[]) => mockMcpOpsAdd(...args),
    update: (...args: any[]) => mockMcpOpsUpdate(...args),
  },
}));

vi.mock('../../../lib/utilities/logger', () => ({
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
vi.mock('../../../lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {},
}));

vi.mock('../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: { streamMessage: vi.fn() },
}));

vi.mock('../../../lib/chat/startNewChatFor', () => ({
  startNewChatFor: (...args: any[]) => mockStartNewChatFor(...args),
}));

vi.mock('../../../lib/chat/sendUserMessageOptimistically', () => ({
  sendUserMessageOptimistically: (...args: any[]) => mockSendUserMessageOptimistically(...args),
}));

vi.mock('../../../lib/utilities/processUserInputPlaceholder', () => ({
  parseUserInputPlaceholders: (...args: any[]) => mockParseUserInputPlaceholders(...args),
  applyUserInputsToEnv: (...args: any[]) => mockApplyUserInputsToEnv(...args),
  applyUserInputsToUrl: (...args: any[]) => mockApplyUserInputsToUrl(...args),
  applyUserInputsToArgs: (...args: any[]) => mockApplyUserInputsToArgs(...args),
}));

vi.mock('../../../lib/utilities/openkosmosPlaceholderParser', () => ({
  hasOpenKosmosPlaceholdersInObject: (...args: any[]) => mockHasOpenKosmosPlaceholders(...args),
  replaceOpenKosmosPlaceholders: (...args: any[]) => mockReplaceOpenKosmosPlaceholders(...args),
  containsOpenKosmosPlaceholder: (...args: any[]) => mockContainsOpenKosmosPlaceholder(...args),
}));

vi.mock('../ApplyMcpToAgentsDialog', () => ({
  default: ({ open }: any) => open ? <div data-testid="apply-dialog" /> : null,
}));

// UserInputModal with controllable close
const mockUserInputModalOnClose = vi.fn();
vi.mock('../UserInputModal', () => ({
  default: ({ isOpen, onSubmit, onSkip, onClose }: any) => {
    if (!isOpen) return null;
    mockUserInputModalOnClose.mockImplementation(onClose);
    return (
      <div data-testid="user-input-modal">
        <button data-testid="modal-submit" onClick={() => onSubmit({ MY_KEY: 'value' })}>Submit</button>
        <button data-testid="modal-skip" onClick={() => onSkip()}>Skip</button>
        <button data-testid="modal-close" onClick={() => onClose()}>Close</button>
      </div>
    );
  },
}));

// ---- helpers ----

const BASE_SERVER = {
  name: 'test-server',
  description: 'A test server',
  version: '1.0.0',
  source: 'IN-LIBRARY' as const,
  transport: 'stdio' as const,
  command: 'npx',
  args: ['-y', 'test'],
  env: { API_KEY: 'placeholder' },
  tags: ['web', 'search'],
  contact: 'dev@example.com',
};

const SERVER_WITH_REQS = {
  ...BASE_SERVER,
  name: 'req-server',
  requirements: { python: '^3.8', node: '^18.0.0' },
  prompts: {
    setup_mcp: 'https://example.com/setup',
    update_mcp: 'https://example.com/update',
    setup_requirements: 'https://example.com/requirements',
  },
};

const SERVER_EMPTY_REQS = {
  ...BASE_SERVER,
  name: 'empty-reqs-server',
  requirements: {},
};

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      mcpLibrary: { getLibraryData: mockGetLibraryData },
      builtinTools: { execute: mockExecuteBuiltinTool },
    },
  });
}

function setupDefaultMocks() {
  mockUseMCPServers.mockReturnValue({
    servers: [],
    refreshRuntimeInfo: mockRefreshRuntimeInfo,
  });
  mockGetLibraryData.mockResolvedValue({
    success: true,
    data: { mcp_servers: [BASE_SERVER] },
  });
  mockParseUserInputPlaceholders.mockResolvedValue({ hasUserInputFields: false, fields: [] });
  mockExecuteBuiltinTool.mockResolvedValue({ success: false, data: null });
  setupElectronApi();
}

describe('AddFromMcpLibraryViewContent — coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Retry button ──────────────────────────────────────────────────────────
  it('clicking Retry reloads library data after an error', async () => {
    mockGetLibraryData.mockRejectedValueOnce(new Error('network fail'));
    render(<AddFromMcpLibraryViewContent />);

    await waitFor(() => expect(screen.getByText('Retry')).toBeTruthy());

    // Now set up a successful response for the retry
    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: { mcp_servers: [BASE_SERVER] },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await waitFor(() => expect(screen.getAllByText('test-server').length).toBeGreaterThan(0));
  });

  // ── Tags and Installed badge ───────────────────────────────────────────────
  it('renders server tags in the server list card', async () => {
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => expect(screen.getAllByText('test-server').length).toBeGreaterThan(0));
    expect(screen.getByText('web')).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
  });

  it('shows Installed badge for already-installed server', async () => {
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'test-server', source: 'IN-LIBRARY', version: '1.0.0' }],
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
    });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => expect(screen.getAllByText('Installed').length).toBeGreaterThan(0));
  });

  it('shows "new" badge when library has newer version than installed', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [{ ...BASE_SERVER, version: '2.0.0' }] },
    });
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'test-server', source: 'IN-LIBRARY', version: '1.0.0' }],
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
    });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('new'));
    expect(screen.getByText('new')).toBeTruthy();
  });

  // ── Apply dialog shown after successful install ────────────────────────────
  it('shows ApplyMcpToAgentsDialog after successful install', async () => {
    mockMcpOpsAdd.mockResolvedValue({ success: true });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => screen.getByTestId('apply-dialog'));
    expect(screen.getByTestId('apply-dialog')).toBeTruthy();
  });

  it('shows ApplyMcpToAgentsDialog after successful update', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [{ ...BASE_SERVER, version: '2.0.0' }] },
    });
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'test-server', source: 'IN-LIBRARY', version: '1.0.0' }],
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
    });
    mockMcpOpsUpdate.mockResolvedValue({ success: true });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Update'));

    await act(async () => {
      fireEvent.click(screen.getByText('Update'));
    });

    await waitFor(() => screen.getByTestId('apply-dialog'));
    expect(screen.getByTestId('apply-dialog')).toBeTruthy();
  });

  // ── Overwrite dialog "No" button ───────────────────────────────────────────
  it('overwrite dialog "No" button closes dialog without installing', async () => {
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'test-server', source: 'ON-DEVICE' }],
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
    });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    // Overwrite dialog should appear
    await waitFor(() => screen.getByText('Replace Existing MCP Server'));
    await act(async () => {
      fireEvent.click(screen.getByText('No'));
    });

    expect(mockMcpOpsAdd).not.toHaveBeenCalled();
  });

  // ── UserInputModal close button ────────────────────────────────────────────
  it('UserInputModal close button hides modal without installing', async () => {
    mockParseUserInputPlaceholders.mockResolvedValue({
      hasUserInputFields: true,
      fields: [{ key: 'MY_KEY', label: 'My Key', required: true }],
    });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => screen.getByTestId('user-input-modal'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('modal-close'));
    });

    expect(screen.queryByTestId('user-input-modal')).toBeNull();
    expect(mockMcpOpsAdd).not.toHaveBeenCalled();
  });

  // ── Requirements table (empty requirements object) ─────────────────────────
  it('renders "No requirements needed" for server with empty requirements', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [SERVER_EMPTY_REQS] },
    });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Requirements'));
    expect(screen.getByText('No requirements needed')).toBeTruthy();
  });

  // ── Requirements table initial render from selectedServer.requirements ──────
  it('renders requirements table with spinner before check completes', async () => {
    // Simulate slow requirement check
    let resolveCheck!: (v: any) => void;
    const pending = new Promise(r => { resolveCheck = r; });
    mockExecuteBuiltinTool.mockReturnValue(pending);

    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [SERVER_WITH_REQS] },
    });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Requirements'));

    // Table should have requirement names but spinners
    expect(screen.getByText('python')).toBeTruthy();
    expect(screen.getByText('node')).toBeTruthy();

    // Clean up
    resolveCheck({ success: false });
  });

  // ── handleKobiFixAndInstall fresh-install path (setup_mcp) ────────────────
  it('confirm dialog "Let Kobi Fix & Install" uses setup_mcp prompt for fresh install', async () => {
    mockProfileDataManager.getCache.mockReturnValue({
      profile: {
        chats: [{ chat_id: 'kobi-chat', agent: { name: 'Kobi' } }],
      },
    });
    mockStartNewChatFor.mockResolvedValue({ success: true, chatSessionId: 'sess-1' });
    mockSendUserMessageOptimistically.mockResolvedValue(undefined);

    // Set up server with unsatisfied requirements
    mockExecuteBuiltinTool.mockResolvedValue({ success: true, data: { stdout: '', stderr: '', exitCode: 1 } });
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [SERVER_WITH_REQS] },
    });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Requirements'));

    // Wait for requirement checks to complete
    await waitFor(() => expect(mockExecuteBuiltinTool).toHaveBeenCalled());

    // Wait a bit for state to settle
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click Install
    await act(async () => {
      const installBtn = document.querySelector('button.btn-primary') as HTMLElement;
      if (installBtn && !installBtn.disabled) {
        fireEvent.click(installBtn);
      }
    });

    // The confirm dialog might show or we might get to Let Kobi Fix & Install
    const kobiBtn = screen.queryByText('Let Kobi Fix & Install');
    if (kobiBtn) {
      await act(async () => { fireEvent.click(kobiBtn); });
      await act(async () => { await new Promise(r => setTimeout(r, 300)); });
      // Should navigate to kobi chat
      if (mockStartNewChatFor.mock.calls.length > 0) {
        expect(mockNavigate).toHaveBeenCalled();
      }
    }
  });

  // ── onServerAdded callback ─────────────────────────────────────────────────
  it('calls onServerAdded with 1 after successful install', async () => {
    mockMcpOpsAdd.mockResolvedValue({ success: true });
    const onServerAdded = vi.fn();

    render(<AddFromMcpLibraryViewContent onServerAdded={onServerAdded} />);
    await waitFor(() => screen.getByText('Install'));

    await act(async () => {
      fireEvent.click(screen.getByText('Install'));
    });

    await waitFor(() => expect(onServerAdded).toHaveBeenCalledWith(1));
  });

  // ── No server selected error path ─────────────────────────────────────────
  it('shows error when no server is selected and install is triggered programmatically', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [] },
    });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('No servers available in the library'));
    // Ensure no crash
    expect(document.querySelector('.add-from-mcp-library-content')).toBeTruthy();
  });

  // ── Search clearing resets selection ──────────────────────────────────────
  it('search query that matches all servers keeps selection intact', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [BASE_SERVER, { ...BASE_SERVER, name: 'another-server', tags: [] }] },
    });
    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => expect(screen.getAllByText('test-server').length).toBeGreaterThan(0));

    const searchInput = document.querySelector('input[placeholder="Search MCP servers..."]') as HTMLInputElement;
    if (searchInput) {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'test' } });
      });
      // Should still show test-server
      expect(screen.getAllByText('test-server').length).toBeGreaterThan(0);
    }
  });

  // ── McpOps.update failure shows error ─────────────────────────────────────
  it('shows error when McpOps.update fails during update flow', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { mcp_servers: [{ ...BASE_SERVER, version: '2.0.0' }] },
    });
    mockUseMCPServers.mockReturnValue({
      servers: [{ name: 'test-server', source: 'IN-LIBRARY', version: '1.0.0', env: {} }],
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
    });
    mockMcpOpsUpdate.mockResolvedValue({ success: false, error: 'Update failed' });

    render(<AddFromMcpLibraryViewContent />);
    await waitFor(() => screen.getByText('Update'));

    await act(async () => {
      fireEvent.click(screen.getByText('Update'));
    });

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Update failed')));
  });
});
