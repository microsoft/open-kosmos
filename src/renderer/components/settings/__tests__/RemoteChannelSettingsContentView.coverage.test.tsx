/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// CSS mocks
// ---------------------------------------------------------------------------

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/SettingsShared.css', () => ({}))
vi.mock('../../../styles/RuntimeSettings.css', () => ({}))
vi.mock('../../../styles/RemoteChannelSettings.css', () => ({}))

// ---------------------------------------------------------------------------
// Lucide icons
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Link2: () => <span>link2</span>,
  Unlink: () => <span>unlink</span>,
  Play: () => <span>play</span>,
  AlertTriangle: () => <span>alert</span>,
  ChevronDown: ({ className }: any) => <span className={className}>chevron</span>,
}))

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'kosmos',
}))

// ---------------------------------------------------------------------------
// Types mock
// ---------------------------------------------------------------------------

vi.mock('@shared/ipc/remoteChannel', () => ({}))

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import RemoteChannelSettingsContentView from '../RemoteChannelSettingsContentView'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatusInfo(overrides: any = {}) {
  return {
    channelId: 'teams',
    status: 'stopped',
    error: undefined,
    ...overrides,
  }
}

function makeBindingStatus(overrides: any = {}) {
  return { bound: false, userId: undefined, ...overrides }
}

function makeChat(overrides: any = {}) {
  return { chatId: 'c1', name: 'Agent A', emoji: '🤖', ...overrides }
}

function renderView(props: any = {}) {
  const defaults = {
    config: { boundChatId: undefined },
    statusInfo: makeStatusInfo(),
    bindingStatus: makeBindingStatus(),
    bindCode: '',
    binding: false,
    error: null,
    bindError: null,
    loading: false,
    chatOptions: [],
    onStartBinding: vi.fn(),
    onSave: vi.fn().mockResolvedValue(true),
    onBindCodeChange: vi.fn(),
    onBind: vi.fn(),
    onDisconnect: vi.fn(),
    ...props,
  }
  return { ...render(<RemoteChannelSettingsContentView {...defaults} />), props: defaults }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RemoteChannelSettingsContentView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading spinner when loading=true', () => {
    renderView({ loading: true })
    expect(screen.getByText('Loading settings...')).toBeTruthy()
  })

  it('does not render main content when loading', () => {
    renderView({ loading: true })
    expect(screen.queryByText('Agent for Teams Messages')).toBeNull()
  })

  it('renders main content when loading=false', () => {
    renderView()
    expect(screen.getByText('Agent for Teams Messages')).toBeTruthy()
  })

  it('renders Teams Binding section', () => {
    renderView()
    expect(screen.getByText('Teams Binding')).toBeTruthy()
  })

  it('shows error alert when error prop is set', () => {
    renderView({ error: 'Something went wrong' })
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })

  it('does not show error alert when error is null', () => {
    renderView({ error: null })
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })

  it('shows "Not bound" status when not bound and stopped', () => {
    renderView({ bindingStatus: makeBindingStatus({ bound: false }), statusInfo: makeStatusInfo({ status: 'stopped' }) })
    expect(screen.getByText('Not bound')).toBeTruthy()
  })

  it('shows "Bound · Online" when bound and running', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.getByText('Bound · Online')).toBeTruthy()
  })

  it('shows "Bound · Offline" when bound but not running', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'stopped' }),
    })
    expect(screen.getByText('Bound · Offline')).toBeTruthy()
  })

  it('shows "Waiting for code" when not bound but channel active', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.getByText('Waiting for code')).toBeTruthy()
  })

  it('shows Start Binding button when canStartBinding=true', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'stopped' }),
    })
    expect(screen.getByText(/Start Binding/)).toBeTruthy()
  })

  it('does not show Start Binding when already bound', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.queryByText(/Start Binding/)).toBeNull()
  })

  it('does not show Start Binding when channel is active', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'starting' }),
    })
    expect(screen.queryByText(/Start Binding/)).toBeNull()
  })

  it('calls onStartBinding when Start Binding button clicked', () => {
    const onStartBinding = vi.fn()
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'stopped' }),
      onStartBinding,
    })
    fireEvent.click(screen.getByText(/Start Binding/))
    expect(onStartBinding).toHaveBeenCalled()
  })

  it('shows Unbind button when bound', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.getByText(/Unbind/)).toBeTruthy()
  })

  it('calls onDisconnect when Unbind clicked', () => {
    const onDisconnect = vi.fn()
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      onDisconnect,
    })
    fireEvent.click(screen.getByText(/Unbind/))
    expect(onDisconnect).toHaveBeenCalled()
  })

  it('shows bound account panel when bound', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true, userId: 'user@example.com' }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.getByText('Bound account')).toBeTruthy()
    expect(screen.getByText('user@example.com')).toBeTruthy()
  })

  it('shows bindError inside bound panel', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: true }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      bindError: 'Binding error occurred',
    })
    expect(screen.getByText('Binding error occurred')).toBeTruthy()
  })

  it('shows binding code input when channel active and not bound', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
    })
    expect(screen.getByPlaceholderText('ABC123')).toBeTruthy()
  })

  it('calls onBindCodeChange when input changes', () => {
    const onBindCodeChange = vi.fn()
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      onBindCodeChange,
    })
    const input = screen.getByPlaceholderText('ABC123')
    fireEvent.change(input, { target: { value: 'xyz123' } })
    expect(onBindCodeChange).toHaveBeenCalledWith('XYZ123')
  })

  it('truncates input at 10 chars in onBindCodeChange', () => {
    const onBindCodeChange = vi.fn()
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      onBindCodeChange,
    })
    const input = screen.getByPlaceholderText('ABC123')
    fireEvent.change(input, { target: { value: 'abcdefghijklmnop' } })
    expect(onBindCodeChange).toHaveBeenCalledWith('ABCDEFGHIJ')
  })

  it('calls onBind when Bind device button clicked', () => {
    const onBind = vi.fn()
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      bindCode: 'ABC123',
      onBind,
    })
    fireEvent.click(screen.getByText(/Bind device/))
    expect(onBind).toHaveBeenCalled()
  })

  it('disables Bind device button when bindCode is empty', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      bindCode: '',
    })
    const btn = screen.getByText(/Bind device/).closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('disables Bind device button when binding=true', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'running' }),
      bindCode: 'ABC123',
      binding: true,
    })
    const btn = screen.getByText('...').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('shows error state when status=error and statusInfo.error is set', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'error', error: 'Connection failed' }),
    })
    expect(screen.getByText('Connection failed')).toBeTruthy()
  })

  it('does not show error state when statusInfo.error is absent', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'error', error: undefined }),
    })
    // alertTriangle icon not in error block
    expect(screen.queryByText('Connection failed')).toBeNull()
  })

  it('renders agent dropdown trigger with placeholder when no chatOptions', () => {
    renderView({ chatOptions: [] })
    expect(screen.getByText('Select an Agent')).toBeTruthy()
  })

  it('renders selected agent in dropdown trigger', () => {
    renderView({
      config: { boundChatId: 'c1' },
      chatOptions: [makeChat({ chatId: 'c1', name: 'Agent A', emoji: '🤖' })],
    })
    expect(screen.getByText('Agent A')).toBeTruthy()
  })

  it('toggles dropdown when trigger clicked', () => {
    renderView({
      config: { boundChatId: 'c1' },
      chatOptions: [makeChat({ chatId: 'c1' }), makeChat({ chatId: 'c2', name: 'Agent B', emoji: '🧠' })],
    })
    const trigger = screen.getByRole('button', { name: /Agent A/ })
    fireEvent.click(trigger)
    expect(screen.getByText('Agent B')).toBeTruthy()
  })

  it('closes dropdown when clicking outside', () => {
    renderView({
      chatOptions: [makeChat(), makeChat({ chatId: 'c2', name: 'Agent B', emoji: '🧠' })],
    })
    const trigger = screen.getAllByRole('button')[0]
    fireEvent.click(trigger)
    // Click outside
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('calls onSave when an agent option is selected', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    renderView({
      config: { boundChatId: 'c1' },
      chatOptions: [
        makeChat({ chatId: 'c1', name: 'Agent A', emoji: '' }),
        makeChat({ chatId: 'c2', name: 'Agent B', emoji: '' }),
      ],
      onSave,
    })
    // Open dropdown
    fireEvent.click(screen.getByText('Agent A').closest('button')!)
    // Click c2 option
    await act(async () => {
      fireEvent.click(screen.getByText('Agent B'))
    })
    expect(onSave).toHaveBeenCalledWith({ boundChatId: 'c2' })
  })

  it('reverts formChatId when onSave returns false', async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    renderView({
      config: { boundChatId: 'c1' },
      chatOptions: [
        makeChat({ chatId: 'c1', name: 'Agent A', emoji: '' }),
        makeChat({ chatId: 'c2', name: 'Agent B', emoji: '' }),
      ],
      onSave,
    })
    fireEvent.click(screen.getByText('Agent A').closest('button')!)
    await act(async () => {
      fireEvent.click(screen.getByText('Agent B'))
    })
    await waitFor(() => {
      expect(screen.getByText('Agent A')).toBeTruthy()
    })
  })

  it('does nothing when selecting already-selected agent', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    renderView({
      config: { boundChatId: 'c1' },
      chatOptions: [makeChat({ chatId: 'c1', name: 'Agent A', emoji: '' })],
      onSave,
    })
    fireEvent.click(screen.getByText('Agent A').closest('button')!)
    await act(async () => {
      fireEvent.click(screen.getAllByText('Agent A')[1] ?? screen.getByText('Agent A'))
    })
    // onSave should not be called since same agent
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows Teams Bot download link', () => {
    renderView()
    expect(screen.getByText(/Download and set up Teams Bot/)).toBeTruthy()
  })

  it('shows bindError in binding-code panel', () => {
    renderView({
      bindingStatus: makeBindingStatus({ bound: false }),
      statusInfo: makeStatusInfo({ status: 'starting' }),
      bindError: 'Invalid code',
    })
    expect(screen.getByText('Invalid code')).toBeTruthy()
  })
})
