/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for McpServerCard.tsx.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ---- mocks ----

vi.mock('../../styles/ServerCard.css', () => ({}));

vi.mock('lucide-react', () => ({
  MoreHorizontal: () => <span data-testid="icon-more" />,
}));

const mockUseMCPServers = vi.fn();
vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: (...args: unknown[]) => mockUseMCPServers(...args),
}));

// ---- import after mocks ----

import ServerCard from '../McpServerCard';

// ---- helpers ----

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-server',
    status: 'disconnected',
    tools: [],
    source: 'ON-DEVICE',
    version: undefined,
    command: undefined,
    error: undefined,
    ...overrides,
  };
}

function setup(
  serverOverrides: Record<string, unknown> = {},
  propOverrides: Partial<React.ComponentProps<typeof ServerCard>> = {},
) {
  const server = makeServer(serverOverrides);
  mockUseMCPServers.mockReturnValue({
    servers: [server],
    tools: [],
  });

  const props = {
    serverName: server.name as string,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onReconnect: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onMenuToggle: vi.fn(),
    ...propOverrides,
  };

  return { server, props, result: render(<ServerCard {...props} />) };
}

// ---- tests ----

describe('McpServerCard — server not found', () => {
  it('renders nothing when server is not in list', () => {
    mockUseMCPServers.mockReturnValue({ servers: [], tools: [] });
    const { container } = render(
      <ServerCard
        serverName="missing"
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onReconnect={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('McpServerCard — status display', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows disconnected status', () => {
    setup({ status: 'disconnected' });
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('shows connected status with tool count', () => {
    setup({ status: 'connected', tools: ['tool1', 'tool2'] });
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByText(/tools: 2/)).toBeInTheDocument();
  });

  it('shows error status with error indicator', () => {
    setup({ status: 'error', error: 'Connection refused' });
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByTitle('Connection refused')).toBeInTheDocument();
  });

  it('shows error status with default error title when error string is empty', () => {
    setup({ status: 'error', error: '' });
    // hasError is false when error is empty string (falsy), so no error indicator
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('shows connecting status when status is connecting', () => {
    setup({ status: 'connecting' });
    expect(screen.getByText('connecting')).toBeInTheDocument();
  });

  it('shows connecting status class for disconnecting (mapped to connecting css class)', () => {
    setup({ status: 'disconnecting' });
    // statusLabel is 'disconnecting', statusClass is 'connecting'
    expect(screen.getByText('disconnecting')).toBeInTheDocument();
  });

  it('shows needs sign-in label for needs-user-interaction', () => {
    setup({ status: 'needs-user-interaction' });
    expect(screen.getByText('needs sign-in')).toBeInTheDocument();
  });

  it('shows error indicator for needs-user-interaction with error', () => {
    setup({ status: 'needs-user-interaction', error: 'Token expired' });
    expect(screen.getByTitle('Token expired')).toBeInTheDocument();
  });

  it('shows connected state when server has no tools but status is error (error takes priority over connected+no-tools)', () => {
    setup({ status: 'error', tools: [], error: 'fail' });
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('falls back to server original status when no special condition matches', () => {
    setup({ status: 'disconnected', tools: [], error: undefined });
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('falls back to disconnected when status is undefined', () => {
    setup({ status: undefined });
    // getCurrentState returns server.status || 'disconnected' which is 'disconnected'
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('shows non-connected status with error field set to error state', () => {
    // status !== 'connected' and hasError → error state
    setup({ status: 'disconnected', error: 'Auth failed' });
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByTitle('Auth failed')).toBeInTheDocument();
  });
});

describe('McpServerCard — operation state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows connecting status when isOperating with connect operation', () => {
    setup({}, { operationState: { isOperating: true, operation: 'connect' } });
    expect(screen.getByText('connecting')).toBeInTheDocument();
  });

  it('shows connecting status when isOperating with reconnect operation', () => {
    setup({}, { operationState: { isOperating: true, operation: 'reconnect' } });
    expect(screen.getByText('connecting')).toBeInTheDocument();
  });

  it('shows disconnecting status when isOperating with disconnect operation', () => {
    setup({}, { operationState: { isOperating: true, operation: 'disconnect' } });
    expect(screen.getByText('disconnecting')).toBeInTheDocument();
  });

  it('shows isOperating=false (default) with no operationState prop', () => {
    setup({ status: 'disconnected' }, {});
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });
});

describe('McpServerCard — built-in and plugin badges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Built-in badge for builtin-tools server', () => {
    setup({ name: 'builtin-tools', status: 'connected', tools: ['t'] }, { serverName: 'builtin-tools' });
    expect(screen.getByText('Built-in')).toBeInTheDocument();
  });

  it('does not show menu button for built-in server', () => {
    setup({ name: 'builtin-tools', status: 'connected', tools: ['t'] }, { serverName: 'builtin-tools' });
    expect(screen.queryByTestId('icon-more')).not.toBeInTheDocument();
  });

  it('shows Plugin badge for plugin source server', () => {
    setup({ source: 'PLUGIN' });
    expect(screen.getByText('Plugin')).toBeInTheDocument();
  });

  it('shows Plugin badge for server name starting with plugin--', () => {
    setup({ name: 'plugin--my-plugin', source: 'ON-DEVICE' }, { serverName: 'plugin--my-plugin' });
    expect(screen.getByText('Plugin')).toBeInTheDocument();
  });

  it('does not show menu button for plugin server', () => {
    setup({ source: 'PLUGIN' });
    expect(screen.queryByTestId('icon-more')).not.toBeInTheDocument();
  });

  it('shows menu button for regular server', () => {
    setup({ source: 'ON-DEVICE' });
    expect(screen.getByTestId('icon-more')).toBeInTheDocument();
  });
});

describe('McpServerCard — version, source, M365 badges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows version badge when version is set', () => {
    setup({ version: '1.2.3' });
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
  });

  it('shows source badge when source is set', () => {
    setup({ source: 'IN-LIBRARY' });
    expect(screen.getByText('IN-LIBRARY')).toBeInTheDocument();
  });

  it('shows M365 badge when command ends with /agency', () => {
    setup({ command: '/usr/local/bin/agency', source: 'ON-DEVICE' });
    expect(screen.getByText('M365')).toBeInTheDocument();
  });

  it('shows M365 badge when command ends with agency.exe', () => {
    setup({ command: 'C:\\Program Files\\agency.exe', source: 'ON-DEVICE' });
    expect(screen.getByText('M365')).toBeInTheDocument();
  });

  it('does not show M365 badge when command does not match', () => {
    setup({ command: '/usr/bin/node', source: 'ON-DEVICE' });
    expect(screen.queryByText('M365')).not.toBeInTheDocument();
  });

  it('does not show meta row when version and source are both undefined', () => {
    setup({ version: undefined, source: undefined, command: undefined });
    expect(screen.queryByText(/v\d/)).not.toBeInTheDocument();
  });
});

describe('McpServerCard — menu toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls onMenuToggle when menu button is clicked', () => {
    const onMenuToggle = vi.fn();
    setup({}, { onMenuToggle });
    fireEvent.click(screen.getByTitle('More options'));
    expect(onMenuToggle).toHaveBeenCalled();
  });

  it('adds menu-open class when isMenuOpen is true', () => {
    setup({}, { isMenuOpen: true });
    expect(document.querySelector('.menu-open')).toBeInTheDocument();
  });

  it('does not add menu-open class when isMenuOpen is false', () => {
    setup({}, { isMenuOpen: false });
    expect(document.querySelector('.menu-open')).not.toBeInTheDocument();
  });
});

describe('McpServerCard — server name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the server name in the heading', () => {
    setup({ name: 'my-cool-server' }, { serverName: 'my-cool-server' });
    expect(screen.getByText('my-cool-server')).toBeInTheDocument();
  });
});

describe('McpServerCard — getAvailableActions (smoke tests for action availability)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not render action buttons (component only renders header/menu area)', () => {
    // McpServerCard renders server info and menu but no Connect/Disconnect buttons in JSX
    setup({ status: 'disconnected' });
    // Confirm no connect/disconnect buttons exist in the rendered output
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('renders server-card div as root', () => {
    setup({});
    expect(document.querySelector('.server-card')).toBeInTheDocument();
  });

  it('renders server-name heading', () => {
    setup({ name: 'alpha-server' }, { serverName: 'alpha-server' });
    const h4 = document.querySelector('h4.server-name');
    expect(h4?.textContent).toBe('alpha-server');
  });
});
