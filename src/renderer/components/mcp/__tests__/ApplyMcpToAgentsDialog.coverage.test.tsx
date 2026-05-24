/** @vitest-environment happy-dom */

import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockShowError = vi.fn()
const mockShowSuccess = vi.fn()
const mockShowWarning = vi.fn()
const mockOnOpenChange = vi.fn()
const mockUpdateChatAgent = vi.fn()

const mockChatsRef = vi.hoisted(() => ({ current: [] as any[] }))
const mockMcpRuntimeServersRef = vi.hoisted(() => ({ current: [] as any[] }))

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}))

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    chats: mockChatsRef.current,
    chatOps: { updateChatAgent: mockUpdateChatAgent },
  }),
  useMCPServers: () => ({
    servers: mockMcpRuntimeServersRef.current,
  }),
}))

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showWarning: mockShowWarning,
  }),
}))

vi.mock('../../../../shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}))

vi.mock('../../../../main/lib/userDataADO/types/profile', () => ({
  isBuiltinAgent: vi.fn().mockReturnValue(false),
}))

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  mcpServerNames: ['test-server'],
}

async function renderComp(props: any = {}) {
  const { default: Comp } = await import('../ApplyMcpToAgentsDialog')
  return render(<Comp {...defaultProps} {...props} />)
}

describe('ApplyMcpToAgentsDialog — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatsRef.current = []
    mockMcpRuntimeServersRef.current = []
    mockUpdateChatAgent.mockResolvedValue({ success: true })
  })

  it('renders dialog when open=true', async () => {
    await act(async () => { await renderComp() })
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByText('Apply to Agents')).toBeInTheDocument()
  })

  it('does not render when open=false', async () => {
    await act(async () => { await renderComp({ open: false }) })
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
  })

  it('shows empty state when no agents', async () => {
    await act(async () => { await renderComp() })
    expect(screen.getByText('No agents found.')).toBeInTheDocument()
  })

  it('shows description with single server name', async () => {
    await act(async () => { await renderComp() })
    expect(screen.getByText(/Select which agents should use "test-server"/)).toBeInTheDocument()
  })

  it('shows description with multiple server names count', async () => {
    await act(async () => { await renderComp({ mcpServerNames: ['server-a', 'server-b'] }) })
    expect(screen.getByText(/Select which agents should use 2 MCP servers/)).toBeInTheDocument()
  })

  it('shows single_agent chats as agent items', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.getByText('My Agent')).toBeInTheDocument()
  })

  it('shows multi_agent chats as agent items', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-2',
        chat_type: 'multi_agent',
        agents: [
          { name: 'Agent A', emoji: '🅰️', mcp_servers: [] },
          { name: 'Agent B', emoji: '🅱️', mcp_servers: [] },
        ],
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.getByText('Agent A')).toBeInTheDocument()
    expect(screen.getByText('Agent B')).toBeInTheDocument()
  })

  it('shows Applied badge when agent already has the MCP server', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [{ name: 'test-server' }] },
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.getByText('Applied')).toBeInTheDocument()
  })

  it('shows Select All button when there are selectable agents', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.getByText('Select All')).toBeInTheDocument()
  })

  it('does not show Select All button when no selectable agents', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [{ name: 'test-server' }] },
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.queryByText('Select All')).not.toBeInTheDocument()
  })

  it('Select All selects all selectable agents', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'Agent 1', emoji: '🤖', mcp_servers: [] },
      },
      {
        chat_id: 'chat-2',
        chat_type: 'single_agent',
        agent: { name: 'Agent 2', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('Select All'))
    expect(screen.getByText(/Apply \(2\)/)).toBeInTheDocument()
  })

  it('Deselect All deselects all agents', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'Agent 1', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    // First select all
    fireEvent.click(screen.getByText('Select All'))
    expect(screen.getByText('Deselect All')).toBeInTheDocument()
    // Then deselect
    fireEvent.click(screen.getByText('Deselect All'))
    expect(screen.getByText('Select All')).toBeInTheDocument()
  })

  it('Skip button calls onOpenChange(false)', async () => {
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('Apply button calls onOpenChange(false) when nothing selected', async () => {
    await act(async () => { await renderComp() })
    // No agents, so newlySelectedCount is 0 — Apply button is disabled
    const applyBtn = screen.getByRole('button', { name: 'Apply' })
    expect(applyBtn).toBeDisabled()
  })

  it('clicking agent checkbox toggles selection', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    const agentRow = screen.getByText('My Agent').closest('[role="checkbox"]')!
    fireEvent.click(agentRow)
    expect(screen.getByText(/Apply \(1\)/)).toBeInTheDocument()
    // Click again to deselect
    fireEvent.click(agentRow)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('does not toggle already applied agent', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [{ name: 'test-server' }] },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    // Apply button should still be disabled (no newly selected)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('applies MCP server to selected agents successfully', async () => {
    mockMcpRuntimeServersRef.current = []
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    // Select the agent
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(mockUpdateChatAgent).toHaveBeenCalledWith('chat-1', {
        mcp_servers: [{ name: 'test-server', tools: [] }],
      })
      expect(mockShowSuccess).toHaveBeenCalled()
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows error when updateChatAgent fails', async () => {
    mockUpdateChatAgent.mockResolvedValue({ success: false })
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalled()
    })
  })

  it('shows agent avatar image when available', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'Agent With Avatar', emoji: '🤖', avatar: 'https://example.com/avatar.png', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    const img = screen.getByAltText('Agent With Avatar')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png')
  })

  it('shows emoji when no avatar', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'Emoji Agent', emoji: '🐙', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    expect(screen.getByText('🐙')).toBeInTheDocument()
  })

  it('handles tool conflict detection and shows conflict summary', async () => {
    mockMcpRuntimeServersRef.current = [
      { name: 'test-server', tools: [{ name: 'search' }, { name: 'browse' }] },
      { name: 'existing-mcp', tools: [{ name: 'search' }] },
    ]
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'My Agent',
          emoji: '🤖',
          mcp_servers: [{ name: 'existing-mcp', tools: [] }],
        },
      },
    ]
    mockUpdateChatAgent.mockResolvedValue({ success: true })
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(mockShowWarning).toHaveBeenCalled()
    })
    // Conflict summary should be shown
    expect(screen.getByText('Tool Conflict Report')).toBeInTheDocument()
  })

  it('conflict summary OK button closes dialog', async () => {
    // test-server has search+browse; existing-mcp only provides search (via explicit tools list)
    // so only search conflicts, browse is non-conflicting -> partial conflict -> conflict summary shown
    mockMcpRuntimeServersRef.current = [
      { name: 'test-server', tools: [{ name: 'search' }, { name: 'browse' }] },
      { name: 'existing-mcp', tools: [{ name: 'search' }] },
    ]
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'My Agent',
          emoji: '🤖',
          // Use explicit tools for existing-mcp so only 'search' is in existingToolOwnership
          mcp_servers: [{ name: 'existing-mcp', tools: ['search'] }],
        },
      },
    ]
    mockUpdateChatAgent.mockResolvedValue({ success: true })
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(screen.getByText('Tool Conflict Report')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('all tools conflict — server not added, conflict report still shown', async () => {
    mockMcpRuntimeServersRef.current = [
      { name: 'test-server', tools: [{ name: 'search' }] },
      { name: 'existing-mcp', tools: [{ name: 'search' }] },
    ]
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'My Agent',
          emoji: '🤖',
          mcp_servers: [{ name: 'existing-mcp', tools: [] }],
        },
      },
    ]
    mockUpdateChatAgent.mockResolvedValue({ success: true })
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      // all tools conflict, server not actually added, successCount=0
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows multiple server names label for bulk apply success', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp({ mcpServerNames: ['server-a', 'server-b'] }) })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('2 MCP servers'))
    })
  })

  it('pre-selects agents that already have all the MCP servers', async () => {
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'Already Applied', emoji: '✅', mcp_servers: [{ name: 'test-server' }] },
      },
    ]
    await act(async () => { await renderComp() })
    // Agent with all servers already applied should show Applied label
    expect(screen.getByText('Applied')).toBeInTheDocument()
  })

  it('resolves agent tools from runtime when entry.tools is empty', async () => {
    mockMcpRuntimeServersRef.current = [
      { name: 'test-server', tools: [{ name: 'tool1' }, { name: 'tool2' }] },
      { name: 'existing-mcp', tools: [{ name: 'tool1' }] },
    ]
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'My Agent',
          emoji: '🤖',
          // existing-mcp entry with empty tools = all tools from existing-mcp
          mcp_servers: [{ name: 'existing-mcp', tools: [] }],
        },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      // tool1 is in both test-server and existing-mcp — should be excluded
      // tool2 is only in test-server — should be included
      expect(mockUpdateChatAgent).toHaveBeenCalledWith('chat-1', {
        mcp_servers: [
          { name: 'existing-mcp', tools: [] },
          { name: 'test-server', tools: ['tool2'] },
        ],
      })
    })
  })

  it('adds server with empty tools when runtime tools unavailable', async () => {
    mockMcpRuntimeServersRef.current = [] // no runtime info
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: { name: 'My Agent', emoji: '🤖', mcp_servers: [] },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(mockUpdateChatAgent).toHaveBeenCalledWith('chat-1', {
        mcp_servers: [{ name: 'test-server', tools: [] }],
      })
    })
  })

  it('shows conflict report with addedToolCount for partial conflict', async () => {
    mockMcpRuntimeServersRef.current = [
      { name: 'test-server', tools: [{ name: 'search' }, { name: 'browse' }] },
      { name: 'old-server', tools: [{ name: 'search' }] },
    ]
    mockChatsRef.current = [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          name: 'My Agent',
          emoji: '🤖',
          mcp_servers: [{ name: 'old-server', tools: ['search'] }],
        },
      },
    ]
    await act(async () => { await renderComp() })
    fireEvent.click(screen.getByText('My Agent').closest('[role="checkbox"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    })
    await waitFor(() => {
      expect(screen.getByText('Tool Conflict Report')).toBeInTheDocument()
    })
    // Should show partial tools added label (e.g., "1/2 tools added")
    expect(screen.getByText(/tools added/)).toBeInTheDocument()
  })
})
