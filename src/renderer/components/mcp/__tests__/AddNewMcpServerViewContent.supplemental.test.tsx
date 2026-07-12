// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AddNewMcpServerViewContent from '../AddNewMcpServerViewContent';
import { useMCPServers } from '../../userData/userDataProvider';

const stableI18n = { t: (key: string) => key, language: 'en', setLanguage: vi.fn() };
const mockNavigate = vi.fn();
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowWarning = vi.fn();
const mockRefreshRuntimeInfo = vi.fn().mockResolvedValue(undefined);
const mockGetServerByName = vi.fn().mockReturnValue(null);
const mockFocus = vi.fn();

vi.mock('@/lib/i18n/useI18n', () => ({ useI18n: () => stableI18n }));
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => mockNavigate }));
vi.mock('../../styles/AddNewMcpServerView.css', () => ({}));
vi.mock('../../ui/ToastProvider', () => ({ useToast: () => ({ showError: mockShowError, showSuccess: mockShowSuccess, showWarning: mockShowWarning }) }));
vi.mock('../../userData/userDataProvider', () => ({ useMCPServers: vi.fn() }));
vi.mock('../../../lib/mcp/mcpOps', () => ({ McpOps: { add: vi.fn().mockResolvedValue({ success: true }), update: vi.fn().mockResolvedValue({ success: true }) } }));
vi.mock('../ApplyMcpToAgentsDialog', () => ({ default: () => null }));

describe('AddNewMcpServerViewContent supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMCPServers).mockReturnValue({
      servers: [{ name: 'existing-server' }],
      addServer: vi.fn(),
      updateServer: vi.fn(),
      refreshRuntimeInfo: mockRefreshRuntimeInfo,
      getServerByName: mockGetServerByName,
    } as any);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        llm: {
          formatMcpConfig: vi.fn().mockResolvedValue({
            success: true,
            data: {
              success: true,
              config: { command: 'python', args: ['main.py'], env: {} },
              transportType: 'stdio',
              serverName: 'verified-server',
            },
          }),
        },
      },
    });

  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes runtime info when edit mode server data is missing', async () => {
    render(<AddNewMcpServerViewContent editServerName="missing-server" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRefreshRuntimeInfo).toHaveBeenCalled();
  });

  it('hydrates edit mode config for StreamableHttp servers including headers', async () => {
    mockGetServerByName.mockReturnValue({
      name: 'streamable',
      transport: 'StreamableHttp',
      url: 'https://server.test',
      env: { TOKEN: 'secret' },
      headers: { Authorization: 'Bearer abc' },
    });

    render(<AddNewMcpServerViewContent editServerName="streamable" />);
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    expect(textarea.value).toContain('https://server.test');
    expect(textarea.value).toContain('Authorization');
  });

  it('focuses the config textarea before verification and the server name after verification', async () => {
    vi.useFakeTimers();
    const realQuerySelector = document.querySelector.bind(document);
    const focusable = { focus: mockFocus };
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '.json-editor' || selector === '.server-name-input') return focusable as any;
      return realQuerySelector(selector);
    });
    render(<AddNewMcpServerViewContent />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mockFocus).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"command":"python","args":["main.py"]}' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /verify/i }));
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText(/mcp\.form\.serverName/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mockFocus).toHaveBeenCalledTimes(2);
  });

  it('surfaces JSON parse failures from the fallback verification path', async () => {
    (window as any).electronAPI.llm.formatMcpConfig = vi.fn().mockResolvedValue({ success: false, error: 'formatter offline' });
    render(<AddNewMcpServerViewContent />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{ bad json' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByText('mcp.add.configValidationFailed')).toBeInTheDocument();
    });
  });
});
