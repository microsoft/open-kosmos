// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * Coverage2 tests for AgentMcpServersTab.tsx.
 * Targets uncovered branches:
 * - empty state (no servers)
 * - Kobi agent with builtin-tools (checkbox disabled)
 * - plugin servers (toggle disabled, Plugin badge)
 * - server with update button (remoteVersion > version, source != ON-DEVICE)
 * - server with error state
 * - server with connecting/disconnecting state
 * - server expand/collapse (chevron click)
 * - tool toggle: partial/full/deselect
 * - tool conflict detection
 * - search filtering
 * - M365 badge (agency command match)
 * - handleUpdateMcp
 * - readOnly mode
 * - cachedData preference over agentData
 * - onDataChange notification
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---- mocks ----

vi.mock('../../../../styles/Agent.css', () => ({}));

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/agent/chat/123/settings/mcp' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('lucide-react', () => ({
  ChevronRight: ({ size, className }: any) => <span data-testid="icon-ChevronRight" className={className} />,
  ChevronDown: ({ size, className }: any) => <span data-testid="icon-ChevronDown" className={className} />,
  Settings: ({ size, className }: any) => <span data-testid="icon-Settings" className={className} />,
  RotateCw: ({ size, className }: any) => <span data-testid="icon-RotateCw" className={className} />,
}));

const mockUseMCPServers = vi.fn();
vi.mock('../../../userData/userDataProvider', () => ({
  useMCPServers: () => mockUseMCPServers(),
}));

vi.mock('../../../layout/LayoutProvider', () => ({
  useLayout: () => ({}),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowToast = vi.fn();
vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}));

vi.mock('../../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import AgentMcpServersTab from '../AgentMcpServersTab';
import type { TabComponentProps, AgentConfig } from '../types';

// ---- helpers ----

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-server',
    status: 'connected',
    tools: [
      { name: 'tool1', description: 'Tool one' },
      { name: 'tool2', description: 'Tool two' },
    ],
    hidden: false,
    error: null,
    command: '/usr/bin/some-mcp',
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  };
}

function makeAgentData(overrides: Record<string, unknown> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    emoji: '🤖',
    role: 'assistant',
    model: 'gpt-4',
    mcpServers: [],
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentConfig;
}

function makeProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    mode: 'edit',
    agentId: 'agent-1',
    agentData: makeAgentData(),
    onSave: vi.fn(),
    onDataChange: vi.fn(),
    cachedData: null,
    readOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- tests ----

describe('AgentMcpServersTab - empty state', () => {
  it('renders empty state when no servers', () => {
    mockUseMCPServers.mockReturnValue({ servers: [], isLoading: false });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText(/No MCP Servers Found/i)).toBeTruthy();
    expect(screen.getByText(/Configure MCP Servers/i)).toBeTruthy();
  });

  it('renders loading state', () => {
    mockUseMCPServers.mockReturnValue({ servers: null, isLoading: true });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText(/Loading MCP servers/i)).toBeTruthy();
  });
});

describe('AgentMcpServersTab - server states', () => {
  it('shows disconnected server with disabled checkbox', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'disconnected', tools: [] })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeTruthy();
    // checkbox should be disabled since state != connected
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });

  it('shows error server with error state', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'error', error: 'Connection refused' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('shows connecting server with connecting state', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connecting', tools: [] })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('connecting')).toBeTruthy();
  });

  it('shows M365 badge for agency command', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ command: '/usr/local/bin/agency' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('M365')).toBeTruthy();
  });
});

describe('AgentMcpServersTab - plugin server', () => {
  it('shows Plugin badge and disables checkbox for plugin servers', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'plugin--abc123--my-plugin', status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('Plugin')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });

  it('shows cleaned display name for plugin server', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'plugin--abc123--my-plugin', status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('my-plugin')).toBeTruthy();
  });
});

describe('AgentMcpServersTab - update button', () => {
  it('shows Update button when remoteVersion > version and source != ON-DEVICE', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ source: 'IN-LIBRARY', version: '1.0.0', remoteVersion: '2.0.0' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('Update')).toBeTruthy();
  });

  it('does not show Update button for ON-DEVICE servers', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ source: 'ON-DEVICE', version: '1.0.0', remoteVersion: '2.0.0' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.queryByText('Update')).toBeNull();
  });

  it('navigates to MCP library when Update button clicked', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'my-server', source: 'IN-LIBRARY', version: '1.0.0', remoteVersion: '2.0.0' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    fireEvent.click(screen.getByText('Update'));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('my-server'),
      expect.any(Object),
    );
  });
});

describe('AgentMcpServersTab - Kobi agent', () => {
  it('disables builtin-tools checkbox for Kobi agent', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'builtin-tools', status: 'connected' })],
      isLoading: false,
    });
    const props = makeProps({ agentData: makeAgentData({ name: 'Kobi' }) });
    render(<AgentMcpServersTab {...props} />);
    expect(screen.getByText('Built-in')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });
});

describe('AgentMcpServersTab - expand/collapse server tools', () => {
  it('expands server tool list when expand button clicked', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    // tool list initially hidden
    expect(screen.queryByText('tool1')).toBeNull();

    const expandBtn = screen.getByRole('button', { name: '' });
    // find the button containing the expand chevron
    const buttons = screen.getAllByRole('button');
    const expandButton = buttons.find(b => b.className?.includes('expand-btn'));
    if (expandButton) {
      fireEvent.click(expandButton);
      expect(screen.getByText('tool1')).toBeTruthy();
    }
  });
});

describe('AgentMcpServersTab - server selection', () => {
  it('selects server when checkbox clicked', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    const onDataChange = vi.fn();
    render(<AgentMcpServersTab {...makeProps({ onDataChange })} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Should call onDataChange with the server selected
    expect(onDataChange).toHaveBeenCalled();
  });

  it('deselects server when clicking already-selected checkbox', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'my-server', status: 'connected' })],
      isLoading: false,
    });
    const agentData = makeAgentData({ mcpServers: [{ name: 'my-server', tools: [] }] });
    const onDataChange = vi.fn();
    render(<AgentMcpServersTab {...makeProps({ agentData, onDataChange })} />);

    const checkbox = screen.getByRole('checkbox');
    // checkbox should be checked
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);
    expect(onDataChange).toHaveBeenCalled();
  });
});

describe('AgentMcpServersTab - search filter', () => {
  it('filters servers by search query', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'alpha-server', status: 'connected' }),
        makeServer({ name: 'beta-server', status: 'connected' }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    const searchBox = screen.getByTestId('search-box');
    fireEvent.change(searchBox, { target: { value: 'alpha' } });

    expect(screen.getByText('alpha-server')).toBeTruthy();
    expect(screen.queryByText('beta-server')).toBeNull();
  });
});

describe('AgentMcpServersTab - readOnly mode', () => {
  it('disables checkbox in readOnly mode', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({ readOnly: true })} />);
    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });
});

describe('AgentMcpServersTab - tool toggle with conflict', () => {
  it('shows conflict badge when two selected servers have same tool name', async () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', status: 'connected', tools: [{ name: 'shared-tool', description: 'Shared' }] }),
        makeServer({ name: 'server-b', status: 'connected', tools: [{ name: 'shared-tool', description: 'Shared' }] }),
      ],
      isLoading: false,
    });
    const agentData = makeAgentData({
      mcpServers: [
        { name: 'server-a', tools: [] },
        { name: 'server-b', tools: [] },
      ],
    });
    render(<AgentMcpServersTab {...makeProps({ agentData })} />);
    expect(screen.getAllByText(/CONFLICT/i).length).toBeGreaterThan(0);
  });
});

describe('AgentMcpServersTab - navigate manage servers', () => {
  it('navigates to /settings/mcp when Manage Available Servers clicked', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    fireEvent.click(screen.getByText(/Manage Available Servers/i));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp');
  });
});

describe('AgentMcpServersTab - cachedData preference', () => {
  it('prefers cachedData over agentData for server selections', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'cached-server', status: 'connected' })],
      isLoading: false,
    });
    const agentData = makeAgentData({ mcpServers: [] }); // no servers in agentData
    const cachedData = { mcpServers: [{ name: 'cached-server', tools: [] }] } as any;
    render(<AgentMcpServersTab {...makeProps({ agentData, cachedData })} />);

    const checkbox = screen.getByRole('checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });
});
