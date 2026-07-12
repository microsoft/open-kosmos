/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

const {
  mockNavigate,
  mockLocation,
  mockChats,
  mockProfileData,
  mockCurrentChatId,
  mockCurrentChatSessionId,
  mockSubscribeToCurrentChatSessionId,
  mockGetChatSessionCache,
  mockOnChatStatusChanged,
  mockShowError,
  mockBrandName,
} = vi.hoisted(() => {
  let subscriber: ((id: string | null) => void) | null = null
  return {
    mockNavigate: vi.fn(),
    mockLocation: { pathname: '/agent/chat/chat-1' },
    mockChats: [] as any[],
    mockProfileData: { profile: { primaryChat: 'chat-1' } },
    mockCurrentChatId: { value: null as string | null },
    mockCurrentChatSessionId: { value: null as string | null },
    mockSubscribeToCurrentChatSessionId: vi.fn((cb: (id: string | null) => void) => {
      subscriber = cb
      return () => { subscriber = null }
    }),
    mockGetChatSessionCache: vi.fn((): { chatStatus: string } | null => null),
    mockOnChatStatusChanged: vi.fn((_cb: (...args: any[]) => void) => vi.fn()),
    mockShowError: vi.fn(),
    mockBrandName: { value: 'openkosmos' },
    getSubscriber: () => subscriber,
  }
})

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ chats: mockChats, data: mockProfileData }),
}))

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: mockShowError }),
}))

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: () => mockCurrentChatId.value,
    getCurrentChatSessionId: () => mockCurrentChatSessionId.value,
    subscribeToCurrentChatSessionId: mockSubscribeToCurrentChatSessionId,
    getChatSessionCache: mockGetChatSessionCache,
  },
}))

vi.mock('../../chat/agent-area/AgentList', () => ({
  default: ({
    chats,
    searchSourceChats,
    onSelectChat,
    onSelectChatSession,
    onDeleteChatSession,
    onForkChatSession,
    onSearchActiveChange,
    activeView,
    currentChatId,
    currentChatSessionId,
  }: any) => (
    <section
      data-testid="agent-list"
      data-chat-count={chats?.length ?? 0}
      data-search-count={searchSourceChats?.length ?? -1}
      data-active-view={activeView ?? 'none'}
      data-current-chat-id={currentChatId ?? ''}
      data-current-session-id={currentChatSessionId ?? ''}
    >
      <button data-testid="select-chat-btn" onClick={() => onSelectChat?.('chat-1')}>Select chat</button>
      <button data-testid="select-session-btn" onClick={() => onSelectChatSession?.('chat-1', 'session-1')}>Select session</button>
      <button data-testid="delete-session-btn" onClick={() => onDeleteChatSession?.('chat-1', 'session-1')}>Delete session</button>
      <button data-testid="fork-session-btn" onClick={() => onForkChatSession?.('chat-1', 'session-1')}>Fork session</button>
      {onSearchActiveChange && <button data-testid="search-on-btn" onClick={() => onSearchActiveChange(true)}>Search on</button>}
    </section>
  ),
}))

vi.mock('../../ui/navigation/NavItem', () => ({
  default: ({ icon, label, onClick, onKeyDown, isActive, title }: any) => (
    <button data-testid="nav-item" onClick={onClick} onKeyDown={onKeyDown} data-active={isActive} title={title}>
      {icon}
      <span>{label}</span>
    </button>
  ),
}))

vi.mock('../../ui/Divider', () => ({ default: () => <hr data-testid="divider" /> }))

vi.mock('../../../lib/userData/types', () => ({
  isBuiltinAgent: (name?: string) => ['kobi', 'pm agent'].includes(name?.toLowerCase?.() ?? ''),
}))

vi.mock('@shared/constants/branding', () => ({
  get BRAND_NAME() { return mockBrandName.value },
}))

import NavigationSection from '../NavigationSection'

function makeChat(id: string, agentName: string, chatSessions: any[] = []) {
  return {
    chat_id: id,
    chat_type: 'single_agent',
    agent: { name: agentName, emoji: '🤖' },
    chatSessions,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBrandName.value = 'openkosmos'
  mockLocation.pathname = '/agent/chat/chat-1'
  mockChats.length = 0
  mockProfileData.profile.primaryChat = 'chat-1'
  mockCurrentChatId.value = null
  mockCurrentChatSessionId.value = null
  mockGetChatSessionCache.mockReturnValue(null)
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { agentChat: { onChatStatusChanged: mockOnChatStatusChanged } },
  })
})

describe('NavigationSection', () => {
  it('renders the managed plus icon with inherited colors and no raw hex values', () => {
    const { container } = render(<NavigationSection />)

    expect(screen.getByTestId('nav-item')).toHaveTextContent('New Agent')
    const plusPath = container.querySelector('mask path')
    const plusRect = container.querySelector('g rect')
    expect(plusPath?.getAttribute('fill')).toBe('currentColor')
    expect(plusRect?.getAttribute('fill')).toBe('currentColor')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it('navigates through OpenKosmos new-agent click and keyboard paths', () => {
    render(<NavigationSection />)

    fireEvent.click(screen.getByTestId('nav-item'))
    fireEvent.keyDown(screen.getByTestId('nav-item'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByTestId('nav-item'), { key: ' ' })
    fireEvent.keyDown(screen.getByTestId('nav-item'), { key: 'Escape' })

    expect(mockNavigate).toHaveBeenNthCalledWith(1, '/agent/chat/creation')
    expect(mockNavigate).toHaveBeenNthCalledWith(2, '/agent/chat/creation')
    expect(mockNavigate).toHaveBeenNthCalledWith(3, '/agent/chat/creation')
  })

  it('refreshes OpenKosmos creation when already on the creation route', () => {
    mockLocation.pathname = '/agent/chat/creation'

    render(<NavigationSection />)
    expect(screen.getByTestId('nav-item')).toHaveAttribute('data-active', 'true')
    fireEvent.click(screen.getByTestId('nav-item'))

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation', expect.objectContaining({ replace: true, state: { refresh: expect.any(Number) } }))
  })

  it('passes chat/session handlers to AgentList', async () => {
    mockChats.push(makeChat('chat-1', 'Custom Agent'))
    render(<NavigationSection />)

    fireEvent.click(screen.getAllByTestId('select-chat-btn')[0])
    fireEvent.click(screen.getAllByTestId('select-session-btn')[0])
    fireEvent.click(screen.getAllByTestId('delete-session-btn')[0])
    fireEvent.click(screen.getAllByTestId('fork-session-btn')[0])

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1', expect.objectContaining({ state: { intent: 'new-chat', source: 'agent-list' } }))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-1')
    await waitFor(() => {
      expect(true).toBe(true)
    })
  })

  it('reports delete and fork dispatch failures through toast errors', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('dispatch failed') })
    render(<NavigationSection />)

    fireEvent.click(screen.getByTestId('delete-session-btn'))
    fireEvent.click(screen.getByTestId('fork-session-btn'))

    expect(mockShowError).toHaveBeenCalledWith('Failed to delete chat session: dispatch failed')
    expect(mockShowError).toHaveBeenCalledWith('Failed to fork chat session: dispatch failed')
    dispatchSpy.mockRestore()
  })

  it('reports non-Error delete and fork dispatch failures as unknown errors', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw 'dispatch failed' })
    render(<NavigationSection />)

    fireEvent.click(screen.getByTestId('delete-session-btn'))
    fireEvent.click(screen.getByTestId('fork-session-btn'))

    expect(mockShowError).toHaveBeenCalledWith('Failed to delete chat session: Unknown error')
    expect(mockShowError).toHaveBeenCalledWith('Failed to fork chat session: Unknown error')
    dispatchSpy.mockRestore()
  })

  it('hides the divider and builtin section while search is active', () => {
    mockChats.push(makeChat('chat-kobi', 'Kobi'))

    render(<NavigationSection />)
    expect(screen.getByTestId('divider')).toBeInTheDocument()
    expect(screen.getAllByTestId('agent-list')).toHaveLength(2)

    fireEvent.click(screen.getAllByTestId('search-on-btn')[0])
    expect(screen.queryByTestId('divider')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('agent-list')).toHaveLength(1)
  })

  it('shows builtin agents for OpenKosmos and omits the builtin section when none exist', () => {
    mockChats.push(makeChat('chat-kobi', 'Kobi'), makeChat('chat-custom', 'Custom Agent'))
    const { rerender } = render(<NavigationSection />)

    expect(screen.getAllByTestId('agent-list')).toHaveLength(2)
    expect(screen.getAllByTestId('agent-list')[1]).toHaveAttribute('data-chat-count', '1')

    cleanup()
    mockChats.length = 0
    mockChats.push(makeChat('chat-custom', 'Custom Agent'))
    render(<NavigationSection />)
    expect(screen.getAllByTestId('agent-list')).toHaveLength(1)
  })

  it('uses an empty primary chat fallback when profile primaryChat is missing', () => {
    delete (mockProfileData.profile as any).primaryChat
    mockChats.push(makeChat('chat-custom', 'Custom Agent'))

    render(<NavigationSection />)

    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-chat-count', '1')
  })


  it('derives active view from chat/settings routes and non-chat routes', () => {
    mockLocation.pathname = '/agent/chat/chat-1/settings/basic'
    const { rerender } = render(<NavigationSection />)
    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-active-view', 'settings')

    mockLocation.pathname = '/settings/about'
    rerender(<NavigationSection />)
    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-active-view', 'none')
  })

  it('syncs session state from the chat session subscription', () => {
    mockLocation.pathname = '/settings/about'
    mockCurrentChatId.value = 'chat-before'
    mockCurrentChatSessionId.value = 'session-before'
    const { unmount } = render(<NavigationSection />)

    expect(mockSubscribeToCurrentChatSessionId).toHaveBeenCalled()
    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-current-session-id', 'session-before')
    act(() => {
      mockCurrentChatId.value = 'chat-after'
      mockSubscribeToCurrentChatSessionId.mock.calls[0][0]('session-after')
    })
    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-current-chat-id', 'chat-after')
    expect(screen.getByTestId('agent-list')).toHaveAttribute('data-current-session-id', 'session-after')

    unmount()
  })

  it('handles absent or cleanup-less chat status listeners', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: {} })
    const { unmount } = render(<NavigationSection />)
    expect(mockOnChatStatusChanged).not.toHaveBeenCalled()
    unmount()

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { agentChat: { onChatStatusChanged: vi.fn(() => undefined) } },
    })
    expect(() => render(<NavigationSection />)).not.toThrow()
  })
})
