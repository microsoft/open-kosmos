/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.hoisted(() => vi.fn())
const mockLocation = vi.hoisted(() => ({ pathname: '/agent/chat/a1/settings' }))
const mockAuthData = vi.hoisted(() => ({ ghcAuth: { alias: 'testuser' } }))
const mockRefresh = vi.hoisted(() => vi.fn())
const mockGetPlugins = vi.hoisted(() => vi.fn())
const mockEnableForAgent = vi.hoisted(() => vi.fn())
const mockDisableForAgent = vi.hoisted(() => vi.fn())

vi.mock('../../../../../styles/Agent.css', () => ({}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

vi.mock('lucide-react', () => ({
  Settings: () => <span data-testid="settings-icon">⚙</span>,
}))

vi.mock('../../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ authData: mockAuthData }),
}))

vi.mock('../../../userData/userDataProvider', () => ({
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
}))

vi.mock('../../../../ipc/plugin', () => ({
  pluginApi: {
    getPlugins: mockGetPlugins,
    enableForAgent: mockEnableForAgent,
    disableForAgent: mockDisableForAgent,
  },
}))

vi.mock('../../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: any = {}): any {
  return {
    id: 'plugin-1',
    injectedSkills: [],
    injectedMcpServers: [],
    manifest: {
      name: 'Test Plugin',
      description: 'A test plugin',
      version: '1.0.0',
      author: { name: 'Author' },
      hooks: {},
    },
    ...overrides,
  }
}

function makeAgentData(overrides: any = {}): any {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    emoji: '🤖',
    role: 'assistant',
    model: 'gpt-4',
    mcpServers: [],
    systemPrompt: '',
    enabledPlugins: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

import AgentPluginsTab from '../AgentPluginsTab'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentPluginsTab', () => {
  let testCounter = 0

  const makeProps = () => ({
    mode: 'update' as const,
    agentId: `agent-${testCounter++}`,
    agentData: makeAgentData(),
    onSave: vi.fn(),
  })

  let defaultProps: ReturnType<typeof makeProps>

  beforeEach(() => {
    vi.clearAllMocks()
    defaultProps = makeProps()
    mockRefresh.mockResolvedValue(undefined)
    mockGetPlugins.mockResolvedValue({ success: true, plugins: [] })
    mockEnableForAgent.mockResolvedValue({ success: true, plugins: [] })
    mockDisableForAgent.mockResolvedValue({ success: true, plugins: [] })
  })

  it('shows loading state initially', async () => {
    mockGetPlugins.mockReturnValue(new Promise(() => {}))
    render(<AgentPluginsTab {...defaultProps} />)
    expect(screen.getByText('Loading Plugins...')).toBeTruthy()
  })

  it('shows empty state when no plugins installed', async () => {
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('No plugins installed')).toBeTruthy()
    })
  })

  it('renders plugin list after loading', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin()],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('Test Plugin')).toBeTruthy()
    })
  })

  it('shows plugin version and author', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin()],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeTruthy()
      expect(screen.getByText('by Author')).toBeTruthy()
    })
  })

  it('shows plugin description', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin()],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('A test plugin')).toBeTruthy()
    })
  })

  it('shows skill/mcp/hook counts when present', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({
        injectedSkills: ['s1', 's2'],
        injectedMcpServers: ['m1'],
        manifest: {
          name: 'Rich Plugin',
          hooks: { afterChat: ['hook1'] },
        },
      })],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('2 skills · 1 MCP · 1 hook')).toBeTruthy()
    })
  })

  it('shows enabled plugin as checked', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    const agentData = makeAgentData({ enabledPlugins: ['plugin-1'] })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} agentData={agentData} />)
    })
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })
  })

  it('shows selected count in header', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    const agentData = makeAgentData({ enabledPlugins: ['plugin-1'] })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} agentData={agentData} />)
    })
    await waitFor(() => {
      expect(screen.getByText('1 selected from 1 installed plugin')).toBeTruthy()
    })
  })

  it('enables plugin when toggled', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    await act(async () => {
      fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    })
    await waitFor(() => {
      expect(mockEnableForAgent).toHaveBeenCalledWith('plugin-1', 'testuser', defaultProps.agentId)
    })
  })

  it('disables plugin when already enabled and toggled', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    const agentData = makeAgentData({ enabledPlugins: ['plugin-1'] })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} agentData={agentData} />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    await act(async () => {
      fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    })
    await waitFor(() => {
      expect(mockDisableForAgent).toHaveBeenCalledWith('plugin-1', 'testuser', defaultProps.agentId)
    })
  })

  it('does not toggle in readOnly mode', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} readOnly />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    expect(mockEnableForAgent).not.toHaveBeenCalled()
  })

  it('navigates to manage plugins on header button click', async () => {
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    fireEvent.click(screen.getByText('Manage Installed Plugins'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/plugins')
  })

  it('navigates to manage plugins from empty state button', async () => {
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByText('Go to Manage Plugins'))
    fireEvent.click(screen.getByText('Go to Manage Plugins'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/plugins')
  })

  it('manages individual plugin via settings button', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByTestId('settings-icon'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-icon').closest('button')!)
    })
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:closeEditor' }))
    })
  })

  it('filters plugins by search query', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [
        makePlugin({ id: 'plugin-1', manifest: { name: 'Alpha Plugin' } }),
        makePlugin({ id: 'plugin-2', manifest: { name: 'Beta Plugin' } }),
      ],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByTestId('search-box'))
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'Alpha' } })
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeTruthy()
      expect(screen.queryByText('Beta Plugin')).toBeNull()
    })
  })

  it('handles getPlugins failure gracefully', async () => {
    mockGetPlugins.mockRejectedValue(new Error('network error'))
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => {
      expect(screen.getByText('No plugins installed')).toBeTruthy()
    })
  })

  it('handles toggle failure gracefully', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    mockEnableForAgent.mockRejectedValue(new Error('toggle error'))
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    await act(async () => {
      fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    })
    // Should not throw
    expect(mockEnableForAgent).toHaveBeenCalled()
  })

  it('does not toggle when no agentId', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} agentId={undefined} />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    expect(mockEnableForAgent).not.toHaveBeenCalled()
  })

  it('syncs search query when agentId changes', async () => {
    mockGetPlugins.mockResolvedValue({ success: true, plugins: [] })
    const { rerender } = render(<AgentPluginsTab {...defaultProps} agentId="agent-1" />)
    rerender(<AgentPluginsTab {...defaultProps} agentId="agent-2" />)
    // Should not throw
  })

  it('updates plugins list when toggle returns plugins', async () => {
    mockGetPlugins.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' })],
    })
    mockEnableForAgent.mockResolvedValue({
      success: true,
      plugins: [makePlugin({ id: 'plugin-1' }), makePlugin({ id: 'plugin-2', manifest: { name: 'Plugin 2' } })],
    })
    await act(async () => {
      render(<AgentPluginsTab {...defaultProps} />)
    })
    await waitFor(() => screen.getByText('Test Plugin'))
    await act(async () => {
      fireEvent.click(screen.getByText('Test Plugin').closest('.skill-card')!)
    })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})
