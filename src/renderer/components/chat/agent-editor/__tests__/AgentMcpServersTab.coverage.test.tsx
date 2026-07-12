/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ---- mocks ----

vi.mock('../../../../styles/Agent.css', () => ({}))

const mockNavigate = vi.fn()
const mockLocation = { pathname: '/agent/chat/123/settings/mcp' }
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

vi.mock('lucide-react', () => ({
  ChevronRight: () => <span data-testid="chevron-right">›</span>,
  ChevronDown: () => <span data-testid="chevron-down">⌄</span>,
  Settings: () => <span data-testid="settings-icon">⚙</span>,
  RotateCw: () => <span data-testid="rotate-icon">↺</span>,
}))

const mockUseMCPServers = vi.fn()
vi.mock('../../../userData/userDataProvider', () => ({
  useMCPServers: () => mockUseMCPServers(),
}))

const mockUseLayout = vi.fn()
vi.mock('../../../layout/LayoutProvider', () => ({
  useLayout: () => mockUseLayout(),
}))

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
const mockShowToast = vi.fn()
vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}))

vi.mock('../../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

import AgentMcpServersTab from '../AgentMcpServersTab'
import type { TabComponentProps, AgentConfig } from '../types'

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
  }
}

function makeAgentData(overrides: Record<string, unknown> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    emoji: '🤖',
    role: 'assistant',
    model: 'gpt-4',
    mcpServers: [],
    systemPrompt: { 'Base.md': '', 'AGENTS.md': '' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentConfig
}

function defaultProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    mode: 'update',
    chatId: 'agent-1',
    agentData: makeAgentData(),
    onSave: vi.fn().mockResolvedValue(makeAgentData()),
    readOnly: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockUseMCPServers.mockReturnValue({ servers: [], isLoading: false })
  mockUseLayout.mockReturnValue({})
  vi.clearAllMocks()
})

// ---- tests ----

describe('AgentMcpServersTab', () => {
  it('renders loading state', () => {
    mockUseMCPServers.mockReturnValue({ servers: [], isLoading: true })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.getByText(/loading mcp servers/i)).toBeInTheDocument()
  })

  it('renders empty state when no servers', () => {
    mockUseMCPServers.mockReturnValue({ servers: [], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.getByText(/no mcp servers found/i)).toBeInTheDocument()
  })

  it('renders server cards', () => {
    mockUseMCPServers.mockReturnValue({ servers: [makeServer()], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.getByText('test-server')).toBeInTheDocument()
  })

  it('renders builtin-tools first and shows built-in badge', () => {
    const builtin = makeServer({ name: 'builtin-tools' })
    const other = makeServer({ name: 'other-server' })
    mockUseMCPServers.mockReturnValue({ servers: [other, builtin], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.getByText('Built-in')).toBeInTheDocument()
  })

  it('navigate to /settings/mcp when manage button clicked', () => {
    mockUseMCPServers.mockReturnValue({ servers: [makeServer()], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    fireEvent.click(screen.getByText('Manage Available Servers'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp')
  })

  it('navigate to /settings/mcp via Configure button in empty state', () => {
    render(<AgentMcpServersTab {...defaultProps()} />)
    fireEvent.click(screen.getByText('Configure MCP Servers'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp')
  })

  it('toggles server selection via checkbox', async () => {
    const onDataChange = vi.fn()
    const server = makeServer()
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    const agentData = makeAgentData({ mcpServers: [] })
    render(<AgentMcpServersTab {...defaultProps({ agentData, onDataChange })} />)

    const checkbox = screen.getByRole('checkbox')
    await act(async () => {
      fireEvent.change(checkbox, { target: { checked: true } })
    })
    // onDataChange should be called
    expect(onDataChange).toHaveBeenCalled()
  })

  it('expands server to show tools when expand button clicked', async () => {
    const server = makeServer()
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)

    const expandBtn = screen.getByTestId('chevron-right').closest('button')!
    await act(async () => {
      fireEvent.click(expandBtn)
    })
    expect(screen.getByText('tool1')).toBeInTheDocument()
    expect(screen.getByText('tool2')).toBeInTheDocument()
  })

  it('collapses server when expand button clicked again', async () => {
    const server = makeServer()
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)

    const expandBtn = screen.getByTestId('chevron-right').closest('button')!
    await act(async () => { fireEvent.click(expandBtn) })
    expect(screen.getByText('tool1')).toBeInTheDocument()

    const collapseBtn = screen.getByTestId('chevron-down').closest('button')!
    await act(async () => { fireEvent.click(collapseBtn) })
    expect(screen.queryByText('tool1')).not.toBeInTheDocument()
  })

  it('filters servers via search box', async () => {
    const s1 = makeServer({ name: 'alpha-server' })
    const s2 = makeServer({ name: 'beta-server' })
    mockUseMCPServers.mockReturnValue({ servers: [s1, s2], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)

    await act(async () => {
      fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'alpha' } })
    })
    expect(screen.getByText('alpha-server')).toBeInTheDocument()
    expect(screen.queryByText('beta-server')).not.toBeInTheDocument()
  })

  it('shows disconnected server as not checkable', () => {
    const server = makeServer({ status: 'disconnected' })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
  })

  it('does not show expand button for disconnected server', () => {
    const server = makeServer({ status: 'disconnected' })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    // The expand button should exist but be disabled
    const chevron = screen.getByTestId('chevron-right').closest('button')!
    expect(chevron).toBeDisabled()
  })

  it('treats legacy remote version metadata as inert', () => {
    const server = makeServer({ source: 'IN-LIBRARY', version: '1.0.0', remoteVersion: '2.0.0' })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.queryByText('Update')).not.toBeInTheDocument()
  })

  it('shows tool count when server is selected', async () => {
    const server = makeServer()
    const agentData = makeAgentData({ mcpServers: [{ name: 'test-server', tools: [] }] })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps({ agentData })} />)
    expect(screen.getByText(/2\/2 tools/)).toBeInTheDocument()
  })

  it('uses cached data over agentData for selection', async () => {
    const server = makeServer()
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    const agentData = makeAgentData({ mcpServers: [] })
    const cachedData = { mcpServers: [{ name: 'test-server', tools: [] }] }
    render(<AgentMcpServersTab {...defaultProps({ agentData, cachedData })} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('hides hidden servers', () => {
    const server = makeServer({ hidden: true })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.queryByText('test-server')).not.toBeInTheDocument()
  })

  it('disables checkboxes in readOnly mode', () => {
    const server = makeServer()
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps({ readOnly: true })} />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('shows summary count for selected tools', () => {
    const server = makeServer()
    const agentData = makeAgentData({ mcpServers: [{ name: 'test-server', tools: [] }] })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps({ agentData })} />)
    expect(screen.getByText(/2 tools selected/i)).toBeInTheDocument()
  })

  it('deselects a server by toggling its checkbox', async () => {
    const onDataChange = vi.fn()
    const server = makeServer()
    const agentData = makeAgentData({ mcpServers: [{ name: 'test-server', tools: [] }] })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps({ agentData, onDataChange })} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()

    await act(async () => {
      fireEvent.change(checkbox, { target: { checked: false } })
    })
    expect(onDataChange).toHaveBeenCalled()
  })

  it('can toggle individual tools when server is expanded and selected', async () => {
    const server = makeServer()
    const agentData = makeAgentData({ mcpServers: [{ name: 'test-server', tools: [] }] })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps({ agentData })} />)

    // Expand
    const expandBtn = screen.getByTestId('chevron-right').closest('button')!
    await act(async () => { fireEvent.click(expandBtn) })

    const toolCheckboxes = screen.getAllByRole('checkbox')
    // index 0 is the server checkbox, 1 and 2 are tools
    await act(async () => {
      fireEvent.change(toolCheckboxes[1], { target: { checked: false } })
    })
    // tool2 should still be visible
    expect(screen.getByText('tool2')).toBeInTheDocument()
  })

  it('handles error status server', () => {
    const server = makeServer({ status: 'error', error: 'Connection refused' })
    mockUseMCPServers.mockReturnValue({ servers: [server], isLoading: false })
    render(<AgentMcpServersTab {...defaultProps()} />)
    expect(screen.getByText('error')).toBeInTheDocument()
  })
})
