/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ---- mocks ----

vi.mock('../../../../styles/Agent.css', () => ({}))

const mockNavigate = vi.fn()
const mockLocation = { pathname: '/agent/chat/123/settings/hooks' }
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

const mockListHooks = vi.fn()
vi.mock('../../../../ipc/agentHooks', () => ({
  agentHooksApi: { listHooks: () => mockListHooks() },
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

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import AgentHooksTab from '../AgentHooksTab'
import type { TabComponentProps, AgentConfig } from '../types'

// ---- helpers ----

function makeHook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    name: 'My Hook',
    enabled: true,
    description: 'a hook',
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: 't',
    updatedAt: 't',
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
    skills: [],
    hooks: [],
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
  vi.clearAllMocks()
  mockListHooks.mockResolvedValue({ success: true, data: [] })
  Object.defineProperty(window, 'sessionStorage', {
    value: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    writable: true,
  })
})

// ---- tests ----

describe('AgentHooksTab', () => {
  it('renders the loading state before hooks resolve', () => {
    mockListHooks.mockReturnValue(new Promise(() => {}))
    render(<AgentHooksTab {...defaultProps()} />)
    expect(screen.getByText(/Loading Hooks/i)).toBeInTheDocument()
  })

  it('renders the empty state when there are no hooks', async () => {
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText(/No available Hooks to select/i)).toBeInTheDocument()
  })

  it('renders hook cards with name, status, and description', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('My Hook')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    const desc = screen.getByText('a hook')
    expect(desc).toBeInTheDocument()
    // The description is a long-form text block, not a pill/badge.
    expect(desc).toHaveClass('skill-card-description')
    expect(desc).not.toHaveClass('skill-card-version')
  })

  it('does not load or offer hook bindings for external agents', async () => {
    const onDataChange = vi.fn()
    const agentData = makeAgentData({ source: 'EXTERNAL', hooks: ['h1'] })

    render(<AgentHooksTab {...defaultProps({ agentData, onDataChange })} />)

    expect(screen.getAllByText('Agent Hooks are unavailable for external agents').length).toBeGreaterThan(0)
    expect(screen.getByText('External agents handle messages outside the local Agent Hooks runtime.')).toBeInTheDocument()
    expect(screen.queryByTestId('search-box')).not.toBeInTheDocument()
    expect(mockListHooks).not.toHaveBeenCalled()
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith('hooks', { hooks: [] }, false))
  })

  it('shows a Disabled badge and omits an absent description', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook({ enabled: false, description: undefined })] })
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('Disabled')).toBeInTheDocument()
    expect(screen.queryByText('a hook')).not.toBeInTheDocument()
  })

  it('shows "0 selected from available hooks" with no selection', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps()} />)
    await screen.findByText('My Hook')
    expect(screen.getByText('0 selected from available hooks')).toBeInTheDocument()
  })

  it('pre-selects hooks bound to the agent and reflects the count', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    const agentData = makeAgentData({ hooks: ['h1'] })
    render(<AgentHooksTab {...defaultProps({ agentData })} />)
    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    })
    expect(screen.getByText('1 selected from available hooks')).toBeInTheDocument()
  })

  it('prefers cachedData hooks over agentData hooks', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook({ id: 'a', name: 'A' }), makeHook({ id: 'b', name: 'B' })] })
    const agentData = makeAgentData({ hooks: ['a'] })
    const cachedData = { hooks: ['b'] }
    render(<AgentHooksTab {...defaultProps({ agentData, cachedData })} />)
    await waitFor(() => {
      const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(boxes[0].checked).toBe(false)
      expect(boxes[1].checked).toBe(true)
    })
  })

  it('toggles a hook selection via the checkbox and notifies the parent', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps({ onDataChange })} />)
    const checkbox = await screen.findByRole('checkbox')
    await act(async () => {
      fireEvent.click(checkbox)
    })
    const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1]
    expect(lastCall[0]).toBe('hooks')
    expect(lastCall[1]).toEqual({ hooks: ['h1'] })
    expect(lastCall[2]).toBe(true)
  })

  it('unselects an already-bound hook', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    const agentData = makeAgentData({ hooks: ['h1'] })
    render(<AgentHooksTab {...defaultProps({ agentData, onDataChange })} />)
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'))
    })
    const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1]
    expect(lastCall[1]).toEqual({ hooks: [] })
  })

  it('does not allow binding a disabled hook', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'd1', name: 'Off Hook', enabled: false })],
    })
    render(<AgentHooksTab {...defaultProps({ onDataChange })} />)
    const checkbox = (await screen.findByLabelText('Bind hook Off Hook')) as HTMLInputElement
    expect(checkbox).toBeDisabled()
    expect(checkbox.checked).toBe(false)
    const before = onDataChange.mock.calls.length
    // Clicking the card body must not bind a disabled hook.
    await act(async () => {
      fireEvent.click(screen.getByText('Off Hook'))
    })
    expect(checkbox.checked).toBe(false)
    expect(onDataChange.mock.calls.length).toBe(before)
  })

  it('allows unbinding a hook that became disabled after it was bound', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'd1', name: 'Off Hook', enabled: false })],
    })
    const agentData = makeAgentData({ hooks: ['d1'] })
    render(<AgentHooksTab {...defaultProps({ agentData, onDataChange })} />)
    const checkbox = (await screen.findByLabelText('Bind hook Off Hook')) as HTMLInputElement
    await waitFor(() => expect(checkbox.checked).toBe(true))
    // A bound-but-disabled hook can still be unbound.
    expect(checkbox).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(checkbox)
    })
    const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1]
    expect(lastCall[1]).toEqual({ hooks: [] })
  })

  it('toggles selection when the card body is clicked', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps({ onDataChange })} />)
    const card = (await screen.findByText('My Hook')).closest('.skill-card')!
    await act(async () => {
      fireEvent.click(card)
    })
    expect(onDataChange).toHaveBeenCalled()
  })

  it('does not toggle when readOnly', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps({ readOnly: true, onDataChange })} />)
    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toBeDisabled()
    const before = onDataChange.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByText('My Hook'))
    })
    expect(onDataChange.mock.calls.length).toBe(before)
  })

  it('filters hooks by the search query', async () => {
    mockListHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'a', name: 'alpha hook' }), makeHook({ id: 'b', name: 'beta hook' })],
    })
    render(<AgentHooksTab {...defaultProps()} />)
    await screen.findByText('alpha hook')
    await act(async () => {
      fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'alpha' } })
    })
    expect(screen.getByText('alpha hook')).toBeInTheDocument()
    expect(screen.queryByText('beta hook')).not.toBeInTheDocument()
  })

  it('navigates to manage hooks from the header button', async () => {
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps()} />)
    await screen.findByText('My Hook')
    fireEvent.click(screen.getByText('Manage Available Hooks'))
    expect(window.sessionStorage.setItem).toHaveBeenCalledWith('previousPath', mockLocation.pathname)
    expect(mockNavigate).toHaveBeenCalledWith('/settings/agent-hooks')
  })

  it('navigates to manage hooks from the empty-state button', async () => {
    render(<AgentHooksTab {...defaultProps()} />)
    fireEvent.click(await screen.findByText('Go to Manage Available Hooks'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/agent-hooks')
  })

  it('opens the Hooks settings page with the hook selected from the per-item manage button', async () => {
    const closeListener = vi.fn()
    window.addEventListener('agent:closeEditor', closeListener)
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook({ id: 'h7', name: 'My Hook' })] })
    render(<AgentHooksTab {...defaultProps()} />)
    await screen.findByText('My Hook')
    fireEvent.click(screen.getByLabelText('Manage hook My Hook'))
    expect(window.sessionStorage.setItem).toHaveBeenCalledWith('previousPath', mockLocation.pathname)
    expect(closeListener).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/settings/agent-hooks?selectHook=h7')
    window.removeEventListener('agent:closeEditor', closeListener)
  })

  it('does not toggle the hook selection when the per-item manage button is clicked', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook({ id: 'h7', name: 'My Hook' })] })
    render(<AgentHooksTab {...defaultProps({ onDataChange })} />)
    await screen.findByText('My Hook')
    const before = onDataChange.mock.calls.length
    fireEvent.click(screen.getByLabelText('Manage hook My Hook'))
    expect(onDataChange.mock.calls.length).toBe(before)
  })

  it('renders the error state when listHooks reports failure with a message', async () => {
    mockListHooks.mockResolvedValue({ success: false, error: 'boom' })
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('Failed to load hooks')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('falls back to a default message when the failure has no error', async () => {
    mockListHooks.mockResolvedValue({ success: false })
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('Failed to load hooks.')).toBeInTheDocument()
  })

  it('renders the error state when listHooks throws an Error', async () => {
    mockListHooks.mockRejectedValue(new Error('network down'))
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('renders a default error message when listHooks throws a non-Error', async () => {
    mockListHooks.mockRejectedValue('nope')
    render(<AgentHooksTab {...defaultProps()} />)
    expect(await screen.findByText('Failed to load hooks.')).toBeInTheDocument()
  })

  it('does not initialize selection or notify when agentData has no id', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    render(<AgentHooksTab {...defaultProps({ agentData: undefined, onDataChange })} />)
    await screen.findByText('My Hook')
    expect(onDataChange).not.toHaveBeenCalled()
  })

  it('treats missing agent hooks as an empty selection', async () => {
    const onDataChange = vi.fn()
    mockListHooks.mockResolvedValue({ success: true, data: [makeHook()] })
    const agentData = makeAgentData({ hooks: undefined })
    render(<AgentHooksTab {...defaultProps({ agentData, onDataChange })} />)
    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    })
    const firstCall = onDataChange.mock.calls[0]
    expect(firstCall[1]).toEqual({ hooks: [] })
    expect(firstCall[2]).toBe(false)
  })

  it('ignores a resolved load after the component unmounts', async () => {
    let resolveLoad: (value: unknown) => void = () => {}
    mockListHooks.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    )
    const { unmount } = render(<AgentHooksTab {...defaultProps()} />)
    expect(screen.getByText(/Loading Hooks/i)).toBeInTheDocument()
    unmount()
    await act(async () => {
      resolveLoad({ success: true, data: [makeHook()] })
      await Promise.resolve()
    })
    expect(screen.queryByText('My Hook')).not.toBeInTheDocument()
  })

  it('ignores a rejected load after the component unmounts', async () => {
    let rejectLoad: (reason: unknown) => void = () => {}
    mockListHooks.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject
      }),
    )
    const { unmount } = render(<AgentHooksTab {...defaultProps()} />)
    unmount()
    await act(async () => {
      rejectLoad(new Error('late failure'))
      await Promise.resolve()
    })
    expect(screen.queryByText('late failure')).not.toBeInTheDocument()
  })
})
