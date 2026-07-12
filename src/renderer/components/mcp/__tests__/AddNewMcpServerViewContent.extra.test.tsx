/**
 * @vitest-environment happy-dom
 *
 * Extra branch-coverage tests for AddNewMcpServerViewContent.tsx —
 * targets paths not hit by the existing test suites: legacy source
 * normalization, handleServerTypeChange's empty-config branch,
 * handleVerify with missing config / transportType from LLM, and the
 * edit-mode focus side-effect.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

const {
  mockNavigate,
  mockShowError,
  mockShowSuccess,
  mockShowWarning,
  mockMcpOpsAdd,
  mockMcpOpsUpdate,
  mockRefreshRuntimeInfo,
  mockFormatMcpConfig,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockShowError: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockMcpOpsAdd: vi.fn().mockResolvedValue({ success: true }),
  mockMcpOpsUpdate: vi.fn().mockResolvedValue({ success: true }),
  mockRefreshRuntimeInfo: vi.fn().mockResolvedValue(undefined),
  mockFormatMcpConfig: vi.fn(),
}));

vi.mock('../../styles/AddNewMcpServerView.css', () => ({}));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showWarning: mockShowWarning,
  }),
}));

vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: vi.fn(),
}));

vi.mock('../../../lib/mcp/mcpOps', () => ({
  McpOps: {
    add: mockMcpOpsAdd,
    update: mockMcpOpsUpdate,
  },
}));

vi.mock('../ApplyMcpToAgentsDialog', () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? (
      <div data-testid="apply-dialog">
        <button onClick={() => onOpenChange(false)}>Close Dialog</button>
      </div>
    ) : null,
}));

import AddNewMcpServerViewContent from '../AddNewMcpServerViewContent';
import { useMCPServers } from '../../userData/userDataProvider';

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      llm: { formatMcpConfig: mockFormatMcpConfig },
    },
  });
}

describe('AddNewMcpServerViewContent — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue(null),
    } as any);
    setupElectronApi();
  });

  it('normalizes a legacy server when editing', async () => {
    const editingServer = {
      name: 'lib-srv',
      transport: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: {},
      version: '2.5.0',
      source: 'IN-LIBRARY',
      remoteVersion: '2.5.0',
    };
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue(editingServer),
    } as any);
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'lib-srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });

    render(<AddNewMcpServerViewContent editServerName="lib-srv" />);
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByRole('button', { name: /Update Server/i }));
    fireEvent.click(screen.getByRole('button', { name: /Update Server/i }));
    await waitFor(() => expect(mockMcpOpsUpdate).toHaveBeenCalled());
    expect(mockMcpOpsUpdate).toHaveBeenCalledWith(
      'lib-srv',
      expect.objectContaining({
        source: 'ON-DEVICE',
        version: '2.5.1',
        remoteVersion: '',
      })
    );
  });

  // ── handleVerify: ipcResult.data is null AND fallback succeeds → updates server name ──
  it('falls back to local JSON parse when LLM fails and uses generated name', async () => {
    // success=false, but config is parseable → llmResponse built from parse.
    mockFormatMcpConfig.mockResolvedValue({ success: false, error: 'LLM down', data: null });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    // The generated server name has the pattern mcp-server-<digits>.
    const nameInput = screen.getByPlaceholderText(/Server Name/i) as HTMLInputElement;
    expect(nameInput.value).toMatch(/^mcp-server-\d+$/);
  });

  // ── handleVerify: llmResponse.config missing — skips config update (line 425 false) ──
  it('handleVerify does not overwrite config when LLM omits config field', async () => {
    const inputConfig = JSON.stringify({ command: 'node', args: ['s.js'] });
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'srv',
        // No config field
      },
    });
    render(<AddNewMcpServerViewContent />);
    const textarea = document.querySelector('.json-editor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: inputConfig } });
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    // Original config preserved.
    expect(textarea.value).toBe(inputConfig);
  });

  // ── handleVerify: llmResponse.transportType missing — skips type update (line 440 false) ──
  it('handleVerify keeps existing transport when LLM omits transportType', async () => {
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        serverName: 'srv',
        config: { command: 'node', args: ['s.js'] },
        // No transportType
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    // Default type 'stdio' shown.
    const typeButton = screen.getByRole('button', { name: /Stdio/i });
    expect(typeButton).toBeInTheDocument();
  });

  // ── handleVerify: serverName empty in LLM response → generated (line 449 true branch) ──
  it('generates a timestamp name when LLM returns blank serverName', async () => {
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: '   ', // Blank
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    const nameInput = screen.getByPlaceholderText(/Server Name/i) as HTMLInputElement;
    expect(nameInput.value).toMatch(/^mcp-server-\d+$/);
  });

  // ── handleAddServer: McpOps.add returns success with empty error string ──
  it('navigates and shows Apply dialog on successful add', async () => {
    mockMcpOpsAdd.mockResolvedValue({ success: true });
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'apply-srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    fireEvent.change(screen.getByPlaceholderText(/Server Name/i), { target: { value: 'apply-srv' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));
    await waitFor(() => expect(mockMcpOpsAdd).toHaveBeenCalled());
    await waitFor(() => screen.getByTestId('apply-dialog'));
    // Close the dialog — should trigger navigation to /settings/mcp.
    fireEvent.click(screen.getByText('Close Dialog'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp');
  });

  // ── handleAddServer: success in edit mode → navigates immediately ──
  it('navigates immediately on successful update (edit mode)', async () => {
    const editingServer = {
      name: 'edit-srv',
      transport: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: {},
      version: '1.0.0',
      source: 'ON-DEVICE',
    };
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue(editingServer),
    } as any);
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'edit-srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent editServerName="edit-srv" />);
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByRole('button', { name: /Update Server/i }));
    fireEvent.click(screen.getByRole('button', { name: /Update Server/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp'));
  });

  // ── Cancel button navigates to settings (covers anonymous handler) ──
  it('Cancel button navigates to /settings/mcp', async () => {
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp');
  });

  // ── Server type dropdown opens and selects SSE / StreamableHttp ──
  it('opens server type dropdown and switches to SSE', async () => {
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    // Open the dropdown
    fireEvent.click(screen.getByRole('button', { name: /Stdio/i }));
    // Click SSE option
    const sseOption = screen.getByRole('button', { name: /^SSE$/ });
    fireEvent.click(sseOption);
    // After type change, the button label is now SSE
    expect(screen.queryByRole('button', { name: /Stdio$/i })).toBeNull();
  });

  // ── Server type change to StreamableHttp ──
  it('opens dropdown and selects StreamableHttp', async () => {
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'srv',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => screen.getByPlaceholderText(/Server Name/i));
    fireEvent.click(screen.getByRole('button', { name: /Stdio/i }));
    fireEvent.click(screen.getByRole('button', { name: /^StreamableHttp$/ }));
  });

  // ── server name update in edit mode — keeps isVerified as-is ──
  it('does not clear verify state on server name change in edit mode', async () => {
    const editingServer = {
      name: 'edit-name',
      transport: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: {},
      version: '1.0.0',
      source: 'ON-DEVICE',
    };
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue(editingServer),
    } as any);
    mockFormatMcpConfig.mockResolvedValue({
      success: true,
      data: {
        success: true,
        transportType: 'stdio',
        serverName: 'edit-name',
        config: { command: 'node', args: ['s.js'] },
      },
    });
    render(<AddNewMcpServerViewContent editServerName="edit-name" />);
    // Server name input is disabled in edit mode, but onChange is still
    // triggered — exercises the `isEditMode` branch of handleServerNameChange.
    fireEvent.change(screen.getByPlaceholderText(/Server Name/i), { target: { value: 'whatever' } });
    expect(screen.getByRole('button', { name: /Update Server/i })).toBeInTheDocument();
  });

  // ── edit mode: editingServer is null but isEditMode is true — refreshes data ──
  it('refreshes runtime info when edit mode but server not found', async () => {
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue(null),
    } as any);
    render(<AddNewMcpServerViewContent editServerName="missing-srv" />);
    await waitFor(() => expect(mockRefreshRuntimeInfo).toHaveBeenCalled());
  });

  // ── No electronAPI.llm: throws "LLM API not available" ──
  it('reports verify error when electronAPI.llm is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { llm: { formatMcpConfig: vi.fn().mockResolvedValue(undefined) } },
    });
    render(<AddNewMcpServerViewContent />);
    fireEvent.change(
      document.querySelector('.json-editor') as HTMLTextAreaElement,
      { target: { value: JSON.stringify({ command: 'node', args: ['s.js'] }) } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));
    await waitFor(() => {
      expect(document.querySelector('.verify-error')?.textContent).toMatch(/LLM API not available/i);
    });
  });
});
