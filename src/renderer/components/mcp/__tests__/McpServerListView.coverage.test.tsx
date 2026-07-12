/** @vitest-environment happy-dom */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import McpServerListView from '../McpServerListView'
import { MCPServerExtended } from '../../../lib/userData/types'

// ---- mocks ----

vi.mock('../../../styles/ServerCard.css', () => ({}))
vi.mock('../../../styles/McpServerListView.css', () => ({}))

vi.mock('../McpServerCard', () => ({
  default: ({ serverName, isSelected, onConnect, onDisconnect, onReconnect, onDelete, onEdit, onMenuToggle }: any) => (
    <div data-testid={`server-card-${serverName}`} data-selected={isSelected}>
      {serverName}
      <button data-testid={`connect-${serverName}`} onClick={onConnect}>connect</button>
      <button data-testid={`disconnect-${serverName}`} onClick={onDisconnect}>disconnect</button>
      <button data-testid={`reconnect-${serverName}`} onClick={onReconnect}>reconnect</button>
      <button data-testid={`delete-${serverName}`} onClick={onDelete}>delete</button>
      <button data-testid={`edit-${serverName}`} onClick={onEdit}>edit</button>
      <button data-testid={`menu-${serverName}`} onClick={onMenuToggle}>menu</button>
    </div>
  ),
}))

vi.mock('../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="search-box"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

// ---- helpers ----

function makeServer(overrides: Partial<MCPServerExtended> = {}): MCPServerExtended {
  return {
    name: 'test-server',
    status: 'disconnected',
    tools: [],
    hidden: false,
    ...overrides,
  } as MCPServerExtended
}

const defaultProps = {
  servers: [],
  isLoading: false,
  operationStates: {},
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onReconnect: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
}

// ---- tests ----

describe('McpServerListView - loading state', () => {
  it('shows loading indicator when isLoading is true', () => {
    render(<McpServerListView {...defaultProps} isLoading={true} />)
    expect(screen.getByText('Loading servers...')).toBeInTheDocument()
  })

  it('does not show loading indicator when isLoading is false', () => {
    render(<McpServerListView {...defaultProps} isLoading={false} />)
    expect(screen.queryByText('Loading servers...')).toBeNull()
  })
})

describe('McpServerListView - empty state', () => {
  it('shows empty state when no servers', () => {
    render(<McpServerListView {...defaultProps} servers={[]} />)
    expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument()
  })

  it('does not show search box when no servers', () => {
    render(<McpServerListView {...defaultProps} servers={[]} />)
    expect(screen.queryByTestId('search-box')).toBeNull()
  })
})

describe('McpServerListView - server list rendering', () => {
  it('renders a server card for each server', async () => {
    const servers = [makeServer({ name: 'srv-a' }), makeServer({ name: 'srv-b' })]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('server-card-srv-a')).toBeInTheDocument()
      expect(screen.getByTestId('server-card-srv-b')).toBeInTheDocument()
    })
  })

  it('shows search box when servers exist', async () => {
    const servers = [makeServer()]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('search-box')).toBeInTheDocument()
    })
  })

  it('auto-selects first server when selectedServer is null', async () => {
    const onSelectServer = vi.fn()
    const servers = [makeServer({ name: 'first-server' }), makeServer({ name: 'second-server' })]
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      expect(onSelectServer).toHaveBeenCalled()
    })
  })

  it('calls onSelectServer when a server card is clicked', async () => {
    const onSelectServer = vi.fn()
    const server = makeServer({ name: 'clickable-server' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[server]}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => screen.getByTestId('server-card-clickable-server'))
    fireEvent.click(screen.getByTestId('server-card-clickable-server').parentElement!)
    expect(onSelectServer).toHaveBeenCalledWith(server)
  })
})

describe('McpServerListView - builtin server pinned at top', () => {
  it('pins builtin-tools server at the top', async () => {
    const servers = [
      makeServer({ name: 'regular-server' }),
      makeServer({ name: 'builtin-tools' }),
    ]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-testid^="server-card-"]')
      expect(cards[0].getAttribute('data-testid')).toBe('server-card-builtin-tools')
    })
  })

  it('applies builtin-server class to builtin-tools wrapper', async () => {
    const servers = [makeServer({ name: 'builtin-tools' })]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      expect(document.querySelector('.builtin-server')).toBeInTheDocument()
    })
  })

  it('hides hidden servers', async () => {
    const servers = [makeServer({ name: 'visible-server' }), makeServer({ name: 'hidden-server', hidden: true })]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => {
      expect(screen.queryByTestId('server-card-hidden-server')).toBeNull()
    })
  })
})

describe('McpServerListView - search filtering', () => {
  it('filters servers based on search query', async () => {
    const servers = [makeServer({ name: 'my-server' }), makeServer({ name: 'other-server' })]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => screen.getByTestId('search-box'))
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'my' } })
    await waitFor(() => {
      expect(screen.getByTestId('server-card-my-server')).toBeInTheDocument()
      expect(screen.queryByTestId('server-card-other-server')).toBeNull()
    })
  })

  it('clears search and shows all servers when query is cleared', async () => {
    const servers = [makeServer({ name: 'my-server' }), makeServer({ name: 'other-server' })]
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={servers}
        onSelectServer={onSelectServer}
      />
    )
    await waitFor(() => screen.getByTestId('search-box'))
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'my' } })
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: '' } })
    await waitFor(() => {
      expect(screen.getByTestId('server-card-my-server')).toBeInTheDocument()
      expect(screen.getByTestId('server-card-other-server')).toBeInTheDocument()
    })
  })
})

describe('McpServerListView - menu state', () => {
  it('applies menu-open class when menu is open for a server', async () => {
    const server = makeServer({ name: 'menu-server' })
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={[server]}
        onSelectServer={onSelectServer}
        mcpServerMenuState={{ isOpen: true, serverName: 'menu-server', position: { top: 0, left: 0 } }}
      />
    )
    await waitFor(() => {
      expect(document.querySelector('.menu-open')).toBeInTheDocument()
    })
  })

  it('calls onMcpServerMenuToggle when appropriate', async () => {
    const onMcpServerMenuToggle = vi.fn()
    const onSelectServer = vi.fn()
    const server = makeServer({ name: 'toggle-server' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[server]}
        onSelectServer={onSelectServer}
        onMcpServerMenuToggle={onMcpServerMenuToggle}
      />
    )
    await waitFor(() => screen.getByTestId('server-card-toggle-server'))
  })
})

describe('McpServerListView - mcpServerOperations effect', () => {
  it('sets window.__mcpServerOperations when mcpServerOperations prop provided', async () => {
    const ops = {
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onReconnect: vi.fn(),
      onDelete: vi.fn(),
      onEdit: vi.fn(),
    }
    const { unmount } = render(
      <McpServerListView
        {...defaultProps}
        servers={[makeServer()]}
        onSelectServer={vi.fn()}
        mcpServerOperations={ops}
      />
    )
    expect((window as any).__mcpServerOperations).toBe(ops)
    unmount()
    expect((window as any).__mcpServerOperations).toBeUndefined()
  })

  it('does not set window.__mcpServerOperations when prop is undefined', () => {
    delete (window as any).__mcpServerOperations
    render(<McpServerListView {...defaultProps} servers={[]} />)
    expect((window as any).__mcpServerOperations).toBeUndefined()
  })
})

describe('McpServerListView - selected server sync', () => {
  it('preserves search query when user typing filters out selected server', async () => {
    const onSelectServer = vi.fn()
    const server = makeServer({ name: 'solo-server' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[server]}
        onSelectServer={onSelectServer}
        selectedServer={server}
      />
    )
    await waitFor(() => screen.getByTestId('search-box'))
    onSelectServer.mockClear()
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'zzz-no-match' } })
    await waitFor(() => {
      expect(screen.getByTestId('search-box')).toHaveValue('zzz-no-match')
    })
    expect(onSelectServer).not.toHaveBeenCalledWith(null)
  })

  it('applies selected class to the selected server wrapper', async () => {
    const server = makeServer({ name: 'selected-server' })
    const onSelectServer = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={[server]}
        onSelectServer={onSelectServer}
        selectedServer={server}
      />
    )
    await waitFor(() => {
      expect(document.querySelector('.server-card-wrapper.selected')).toBeInTheDocument()
    })
  })
})

describe('McpServerListView - server status states', () => {
  const cases: Array<[string, Partial<MCPServerExtended>]> = [
    ['connected', { status: 'connected', tools: [{ name: 't' }] as any }],
    ['error', { status: 'error', error: 'some error' }],
    ['connecting', { status: 'connecting' }],
    ['disconnecting', { status: 'disconnecting' }],
  ]

  cases.forEach(([label, serverOverrides]) => {
    it(`renders server card for status: ${label}`, async () => {
      const server = makeServer({ name: `${label}-server`, ...serverOverrides })
      const onSelectServer = vi.fn()
      render(
        <McpServerListView
          {...defaultProps}
          servers={[server]}
          onSelectServer={onSelectServer}
        />
      )
      await waitFor(() => {
        expect(screen.getByTestId(`server-card-${label}-server`)).toBeInTheDocument()
      })
    })
  })
})

describe('McpServerListView - server card action callbacks', () => {
  it('wires connect/disconnect/reconnect/delete/edit callbacks to the server name', () => {
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    const onReconnect = vi.fn()
    const onDelete = vi.fn()
    const onEdit = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={[makeServer({ name: 'act' })]}
        onSelectServer={vi.fn()}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onReconnect={onReconnect}
        onDelete={onDelete}
        onEdit={onEdit}
      />
    )
    fireEvent.click(screen.getByTestId('connect-act'))
    expect(onConnect).toHaveBeenCalledWith('act')
    fireEvent.click(screen.getByTestId('disconnect-act'))
    expect(onDisconnect).toHaveBeenCalledWith('act')
    fireEvent.click(screen.getByTestId('reconnect-act'))
    expect(onReconnect).toHaveBeenCalledWith('act')
    fireEvent.click(screen.getByTestId('delete-act'))
    expect(onDelete).toHaveBeenCalledWith('act')
    fireEvent.click(screen.getByTestId('edit-act'))
    expect(onEdit).toHaveBeenCalledWith('act')
  })

  it('calls onMcpServerMenuToggle with the server name when the menu button is clicked', () => {
    const onMcpServerMenuToggle = vi.fn()
    render(
      <McpServerListView
        {...defaultProps}
        servers={[makeServer({ name: 'mt' })]}
        onSelectServer={vi.fn()}
        onMcpServerMenuToggle={onMcpServerMenuToggle}
      />
    )
    fireEvent.click(screen.getByTestId('menu-mt'))
    expect(onMcpServerMenuToggle).toHaveBeenCalledWith('mt', expect.anything())
  })

  it('does not throw when the menu button is clicked without an onMcpServerMenuToggle handler', () => {
    render(
      <McpServerListView
        {...defaultProps}
        servers={[makeServer({ name: 'nm' })]}
        onSelectServer={vi.fn()}
      />
    )
    expect(() => fireEvent.click(screen.getByTestId('menu-nm'))).not.toThrow()
  })

  it('falls back to a "Server N" label when a server has no name', () => {
    render(
      <McpServerListView
        {...defaultProps}
        servers={[makeServer({ name: undefined as any })]}
        onSelectServer={vi.fn()}
      />
    )
    expect(screen.getByTestId('server-card-Server 1')).toBeInTheDocument()
  })
})

describe('McpServerListView - selection sync edge cases', () => {
  it('clears a stale selection when the server list is empty', () => {
    const onSelectServer = vi.fn()
    const stale = makeServer({ name: 'stale' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[]}
        onSelectServer={onSelectServer}
        selectedServer={stale}
      />
    )
    expect(onSelectServer).toHaveBeenCalledWith(null)
  })

  it('selects first filtered server when user typing excludes current selection', async () => {
    const onSelectServer = vi.fn()
    const alpha = makeServer({ name: 'alpha' })
    const beta = makeServer({ name: 'beta' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[alpha, beta]}
        onSelectServer={onSelectServer}
        selectedServer={alpha}
      />
    )
    await waitFor(() => screen.getByTestId('search-box'))
    onSelectServer.mockClear()
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'beta' } })
    await waitFor(() => {
      expect(onSelectServer).toHaveBeenCalledWith(beta)
    })
  })

  it('selects the first filtered server when the selected one is no longer in the list', () => {
    const onSelectServer = vi.fn()
    const alpha = makeServer({ name: 'alpha' })
    const beta = makeServer({ name: 'beta' })
    const gone = makeServer({ name: 'gone' })
    render(
      <McpServerListView
        {...defaultProps}
        servers={[alpha, beta]}
        onSelectServer={onSelectServer}
        selectedServer={gone}
      />
    )
    // sortedServers reverses regular servers => [beta, alpha]; first is beta
    expect(onSelectServer).toHaveBeenCalledWith(beta)
  })
})
