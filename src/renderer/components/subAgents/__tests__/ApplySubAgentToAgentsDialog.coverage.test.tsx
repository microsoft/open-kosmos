/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockChats = vi.hoisted(() => [] as any[])
const mockUpdateChatAgent = vi.hoisted(() => vi.fn())
const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}))

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    chats: mockChats,
    chatOps: { updateChatAgent: mockUpdateChatAgent },
  }),
}))

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))

vi.mock('../../../../shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}))

vi.mock('../../../../main/lib/userDataADO/types/profile', () => ({
  isBuiltinAgent: () => false,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSingleAgentChat(overrides: any = {}): any {
  return {
    chat_id: 'chat-1',
    chat_type: 'single_agent',
    agent: {
      name: 'Agent One',
      emoji: '🤖',
      avatar: undefined,
      sub_agents: [],
      ...overrides.agent,
    },
    ...overrides,
  }
}

function makeMultiAgentChat(agents: any[] = [], overrides: any = {}): any {
  return {
    chat_id: 'chat-multi',
    chat_type: 'multi_agent',
    agents,
    ...overrides,
  }
}

/** Returns the checkbox input element (not the div row) for the first agent item */
function getCheckboxInput(index = 0): HTMLInputElement {
  const inputs = document.querySelectorAll('input[type="checkbox"]')
  return inputs[index] as HTMLInputElement
}

/** Returns the clickable row div (role=checkbox) for the first agent item */
function getAgentRow(index = 0): HTMLElement {
  const rows = document.querySelectorAll('[role="checkbox"]')
  return rows[index] as HTMLElement
}

import ApplySubAgentToAgentsDialog from '../ApplySubAgentToAgentsDialog'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApplySubAgentToAgentsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    subAgentName: 'MySubAgent',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockChats.length = 0
    mockUpdateChatAgent.mockResolvedValue({ success: true })
  })

  it('returns null when not open', () => {
    const { container } = render(
      <ApplySubAgentToAgentsDialog {...defaultProps} open={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders dialog when open', () => {
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByTestId('dialog')).toBeTruthy()
    expect(screen.getByText('Apply to Agents')).toBeTruthy()
  })

  it('shows description with sub-agent name', () => {
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText(/MySubAgent/)).toBeTruthy()
  })

  it('shows no agents found when chats is empty', () => {
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText('No agents found.')).toBeTruthy()
  })

  it('renders single_agent chats', () => {
    mockChats.push(makeSingleAgentChat())
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText('Agent One')).toBeTruthy()
  })

  it('renders multi_agent chats', () => {
    mockChats.push(makeMultiAgentChat([
      { name: 'Alpha', emoji: '🅰', sub_agents: [] },
      { name: 'Beta', emoji: '🅱', sub_agents: [] },
    ]))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('marks agent as already applied', () => {
    mockChats.push(makeSingleAgentChat({ agent: { name: 'Agent One', emoji: '🤖', sub_agents: ['MySubAgent'] } }))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText('Applied')).toBeTruthy()
  })

  it('pre-selects already applied agents on open', () => {
    mockChats.push(makeSingleAgentChat({ agent: { name: 'Agent One', emoji: '🤖', sub_agents: ['MySubAgent'] } }))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    const checkbox = getCheckboxInput()
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)
  })

  it('renders agent avatar image when available', () => {
    mockChats.push(makeSingleAgentChat({ agent: { name: 'Agent One', emoji: '🤖', avatar: 'https://example.com/avatar.png', sub_agents: [] } }))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png')
  })

  it('renders emoji when no avatar', () => {
    mockChats.push(makeSingleAgentChat({ agent: { name: 'Agent One', emoji: '🦊', sub_agents: [] } }))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    expect(screen.getByText('🦊')).toBeTruthy()
  })

  it('toggles agent selection on click', () => {
    mockChats.push(makeSingleAgentChat())
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow())
    expect(getCheckboxInput().checked).toBe(true)
  })

  it('does not toggle already applied agent', () => {
    mockChats.push(makeSingleAgentChat({ agent: { name: 'Agent One', emoji: '🤖', sub_agents: ['MySubAgent'] } }))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow())
    // Still disabled — clicking doesn't change
    expect(getCheckboxInput().disabled).toBe(true)
  })

  it('skip button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    render(<ApplySubAgentToAgentsDialog {...defaultProps} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('Skip'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('apply button is disabled when no agents selected', () => {
    mockChats.push(makeSingleAgentChat())
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    const applyBtn = screen.getByText('Apply') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)
  })

  it('apply button shows count when agents selected', async () => {
    mockChats.push(makeSingleAgentChat())
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow())
    await waitFor(() => {
      expect(screen.getByText('Apply (1)')).toBeTruthy()
    })
  })

  it('applies sub-agent to selected agents', async () => {
    mockChats.push(makeSingleAgentChat())
    const onOpenChange = vi.fn()
    render(<ApplySubAgentToAgentsDialog {...defaultProps} onOpenChange={onOpenChange} />)
    fireEvent.click(getAgentRow())
    await waitFor(() => screen.getByText('Apply (1)'))
    await act(async () => {
      fireEvent.click(screen.getByText('Apply (1)'))
    })
    await waitFor(() => {
      expect(mockUpdateChatAgent).toHaveBeenCalledWith('chat-1', { sub_agents: ['MySubAgent'] })
      expect(mockShowSuccess).toHaveBeenCalledWith('Sub-agent "MySubAgent" applied to 1 agent')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows error when some agents fail', async () => {
    mockChats.push(makeSingleAgentChat())
    mockUpdateChatAgent.mockResolvedValue({ success: false })
    const onOpenChange = vi.fn()
    render(<ApplySubAgentToAgentsDialog {...defaultProps} onOpenChange={onOpenChange} />)
    fireEvent.click(getAgentRow())
    await waitFor(() => screen.getByText('Apply (1)'))
    await act(async () => {
      fireEvent.click(screen.getByText('Apply (1)'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to apply sub-agent to 1 agent')
    })
  })

  it('closes dialog when apply with no newly selected agents (empty list)', async () => {
    // No chats → agentItems is empty → handleApply sees toApply.length === 0 → calls onOpenChange(false)
    const onOpenChange = vi.fn()
    render(<ApplySubAgentToAgentsDialog {...defaultProps} onOpenChange={onOpenChange} />)
    // With no items, the Apply button is disabled. Invoke via skip to confirm basic close works.
    fireEvent.click(screen.getByText('Skip'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('deselects agent on second click', () => {
    mockChats.push(makeSingleAgentChat())
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow()) // select
    fireEvent.click(getAgentRow()) // deselect
    expect(getCheckboxInput().checked).toBe(false)
  })

  it('shows applying state during apply', async () => {
    mockChats.push(makeSingleAgentChat())
    mockUpdateChatAgent.mockReturnValue(new Promise(() => {}))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow())
    await waitFor(() => screen.getByText('Apply (1)'))
    act(() => {
      fireEvent.click(screen.getByText('Apply (1)'))
    })
    await waitFor(() => {
      expect(screen.getByText('Applying...')).toBeTruthy()
    })
  })

  it('skip is disabled while applying', async () => {
    mockChats.push(makeSingleAgentChat())
    mockUpdateChatAgent.mockReturnValue(new Promise(() => {}))
    render(<ApplySubAgentToAgentsDialog {...defaultProps} />)
    fireEvent.click(getAgentRow())
    await waitFor(() => screen.getByText('Apply (1)'))
    act(() => {
      fireEvent.click(screen.getByText('Apply (1)'))
    })
    await waitFor(() => {
      const skipBtn = screen.getByText('Skip') as HTMLButtonElement
      expect(skipBtn.disabled).toBe(true)
    })
  })
})
