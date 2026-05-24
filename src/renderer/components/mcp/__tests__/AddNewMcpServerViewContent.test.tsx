/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddNewMcpServerViewContent from '../AddNewMcpServerViewContent';
import { useMCPServers } from '../../userData/userDataProvider';

// ---- mocks ----

const mockNavigate = vi.fn();
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowWarning = vi.fn();
const mockAddServer = vi.fn();
const mockUpdateServer = vi.fn();
const mockRefreshRuntimeInfo = vi.fn();
const mockGetServerByName = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../styles/AddNewMcpServerView.css', () => ({}));

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
    add: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
  },
  default: {
    add: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../ApplyMcpToAgentsDialog', () => ({
  default: () => null,
}));

// ---- helpers ----

const VALID_STDIO_CONFIG = JSON.stringify({
  command: 'python',
  args: ['main.py'],
  env: {},
});

function setupElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      llm: {
        formatMcpConfig: vi.fn().mockResolvedValue({
          success: true,
          transportType: 'stdio',
          serverName: 'my-server',
          nameSource: 'generated',
          config: { command: 'python', args: ['main.py'], env: {} },
          warnings: [],
          errors: [],
        }),
      },
    },
  });
}

// ---- tests ----

describe('AddNewMcpServerViewContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: mockAddServer,
      updateServer: mockUpdateServer,
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: mockGetServerByName.mockReturnValue(null),
    } as any);

    setupElectronApi();
  });

  it('renders server config textarea and Verify button', () => {
    render(<AddNewMcpServerViewContent />);

    expect(screen.getByRole('button', { name: /Verify to Continue/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('Verify button is disabled when config textarea is empty', () => {
    render(<AddNewMcpServerViewContent />);

    expect(screen.getByRole('button', { name: /Verify to Continue/i })).toBeDisabled();
  });

  it('Verify button becomes enabled when config is entered', () => {
    render(<AddNewMcpServerViewContent />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: VALID_STDIO_CONFIG } });

    expect(screen.getByRole('button', { name: /Verify to Continue/i })).not.toBeDisabled();
  });

  it('shows server name and type fields after successful verification', async () => {
    render(<AddNewMcpServerViewContent />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: VALID_STDIO_CONFIG } });

    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));

    await waitFor(() => {
      // After verification, name input and server type section should appear
      expect(screen.getByPlaceholderText(/server name/i)).toBeInTheDocument();
    });
  });

  it('shows verify error when AI formatting returns failure', async () => {
    (window.electronAPI as any).llm.formatMcpConfig = vi.fn().mockResolvedValue({
      success: false,
      errors: ['Invalid config format'],
    });

    render(<AddNewMcpServerViewContent />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '{ bad json' } });

    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));

    await waitFor(() => {
      // Either a verify error or validation error should be visible
      const errorEls = document.querySelectorAll('.verify-error, .validation-error');
      expect(errorEls.length).toBeGreaterThan(0);
    });
  });

  it('shows Add Server button after verification', async () => {
    render(<AddNewMcpServerViewContent />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: VALID_STDIO_CONFIG } });
    fireEvent.click(screen.getByRole('button', { name: /Verify to Continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Server/i })).toBeInTheDocument();
    });
  });

  it('renders in edit mode when editServerName is provided', () => {
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [],
      addServer: mockAddServer,
      updateServer: mockUpdateServer,
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: vi.fn().mockReturnValue({
        name: 'existing-server',
        transport: 'stdio',
        command: 'python',
        args: ['main.py'],
        env: {},
      }),
    } as any);

    render(<AddNewMcpServerViewContent editServerName="existing-server" />);

    // In edit mode, the Update button should be visible (not Verify)
    expect(screen.getByRole('button', { name: /Update Server/i })).toBeInTheDocument();
  });
});
