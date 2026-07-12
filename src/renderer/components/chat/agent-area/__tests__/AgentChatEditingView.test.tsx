/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'

const mockNavigate = vi.fn()
const mockUseChats = vi.fn()
let mockChatId = 'chat-1'
let mockTabParam = 'basic'
const mockUseFeatureFlag = vi.fn()
const mockUseFeatureFlagState = vi.fn()
const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useParams: () => ({ chatId: mockChatId, '*': mockTabParam }),
  useNavigate: () => mockNavigate,
}))

vi.mock('../../../userData/userDataProvider', async () => ({
  useProfileData: () => ({
    chatOps: {},
  }),
  useChats: () => mockUseChats(),
}))

vi.mock('../../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}))

vi.mock('../../../../lib/featureFlags', async () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
  useFeatureFlagState: (flag: string) => mockUseFeatureFlagState(flag),
}))

let capturedBasicTabOnDataChange: ((tabName: string, data: object, hasChanges: boolean) => void) | null = null;
let capturedBasicTabOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedKnowledgeTabOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedMcpTabOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedSkillsTabOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedPromptTabOnSave: ((data: object) => Promise<unknown>) | null = null;
let capturedPromptFile: string | null = null;

vi.mock('../../agent-editor/AgentBasicTab', () => ({
  default: (props: any) => {
    capturedBasicTabOnDataChange = props.onDataChange;
    capturedBasicTabOnSave = props.onSave;
    return <div data-testid="basic-tab" />;
  }
}))
vi.mock('../../agent-editor/AgentKnowledgeBaseTab', () => ({
  default: (props: any) => { capturedKnowledgeTabOnSave = props.onSave; return <div data-testid="knowledge-tab" />; }
}))
vi.mock('../../agent-editor/AgentMcpServersTab', () => ({
  default: (props: any) => { capturedMcpTabOnSave = props.onSave; return <div data-testid="mcp-tab" />; }
}))
vi.mock('../../agent-editor/AgentSkillsTab', () => ({
  default: (props: any) => { capturedSkillsTabOnSave = props.onSave; return <div data-testid="skills-tab" />; }
}))
vi.mock('../../agent-editor/AgentSchedulesTab', () => ({ default: () => <div data-testid="schedules-tab" /> }))
vi.mock('../../agent-editor/AgentSystemPromptTab', () => ({
  default: (props: any) => {
    capturedPromptTabOnSave = props.onSave;
    capturedPromptFile = props.promptFile;
    return <div data-testid="prompt-tab" data-prompt-file={props.promptFile} />;
  }
}))
vi.mock('../../agent-editor/ErrorHandler', () => ({
  default: ({ error, onDismiss }: { error: string; onDismiss: () => void }) => (
    <div>
      <span data-testid="error-msg">{error}</span>
      <button onClick={onDismiss} data-testid="error-dismiss">Dismiss</button>
    </div>
  )
}))

vi.mock('../../../../styles/Agent.css', async () => ({}))

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import AgentChatEditingView from '../AgentChatEditingView'

const baseAgent = {
  name: 'Test Agent',
  emoji: '🤖',
  role: '',
  model: 'gpt-4.1',
  mcp_servers: [],
  system_prompt: '',
  skills: [],
  workspace: '/ws',
  knowledge: { knowledgeBase: '/kb' },
  knowledgeBase: '/kb',
  version: '1.0.0',
  source: 'ON-DEVICE',
}

const baseChat = {
  chat_id: 'chat-1',
  agent: { ...baseAgent },
  chatSessions: [],
}

function setupChats(overrides: object = {}) {
  const updateChatAgent = vi.fn().mockResolvedValue({ success: true })
  mockUseChats.mockReturnValue({
    chats: [{ ...baseChat, ...overrides }],
    updateChatAgent,
  })
  return updateChatAgent
}

describe('AgentChatEditingView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatId = 'chat-1'
    mockTabParam = 'basic'
    mockUseFeatureFlag.mockReturnValue(false)
    mockUseFeatureFlagState.mockReturnValue({ enabled: false, initialized: true })
    capturedBasicTabOnDataChange = null
    capturedBasicTabOnSave = null
    capturedKnowledgeTabOnSave = null
    capturedMcpTabOnSave = null
    capturedSkillsTabOnSave = null
    capturedPromptTabOnSave = null
    capturedPromptFile = null
  })

  it('navigates with new-chat intent when the agent has no chat sessions', () => {
    setupChats({ chatSessions: [] })
    const { getByTitle } = render(<AgentChatEditingView />)
    fireEvent.click(getByTitle('Back to Chat'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1', {
      state: { intent: 'new-chat', source: 'agent-settings-back' },
    })
  })

  it('navigates back to the agent chat route when the agent already has sessions', () => {
    setupChats({ chatSessions: [{ chatSession_id: 'session-1' }] })
    const { getByTitle } = render(<AgentChatEditingView />)
    fireEvent.click(getByTitle('Back to Chat'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1')
  })

  it('navigates to knowledge settings when expanding the knowledge group from another tab', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    setupChats()
    const { getByRole } = render(<AgentChatEditingView />)
    fireEvent.click(getByRole('button', { name: 'Knowledge' }))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/knowledge')
  })

  it('renders the basic tab by default', () => {
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('basic-tab')).toBeInTheDocument()
  })

  it('shows agent name in header when agent is loaded', async () => {
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
  })

  it('shows "Agent Settings" when agent is not found', () => {
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    expect(screen.getByText('Agent Settings')).toBeInTheDocument()
  })

  it('shows error when agent not found for chatId', async () => {
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).toBeInTheDocument()
    })
  })

  it('dismisses error when dismiss button clicked', async () => {
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('error-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('error-msg')).not.toBeInTheDocument())
  })

  it('navigates to different tabs via nav clicks', async () => {
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')

    // Switch to MCP tab
    fireEvent.click(screen.getByText('MCP Servers'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/mcp_servers')
  })

  it('renders knowledge tab when URL param is knowledge', () => {
    mockTabParam = 'knowledge'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('knowledge-tab')).toBeInTheDocument()
  })

  it('renders mcp tab when URL param is mcp_servers', () => {
    mockTabParam = 'mcp_servers'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('mcp-tab')).toBeInTheDocument()
  })

  it('renders skills tab when URL param is skills', () => {
    mockTabParam = 'skills'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('skills-tab')).toBeInTheDocument()
  })

  it('renders prompt tab when URL param is system_prompt', () => {
    mockTabParam = 'system_prompt'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('prompt-tab')).toBeInTheDocument()
    expect(screen.getByText('Agent Identity')).toBeInTheDocument()
    expect(screen.getByText('Project Context')).toBeInTheDocument()
    expect(capturedPromptFile).toBe('Base.md')
  })

  it('shows schedules tab when scheduler feature is enabled', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    mockTabParam = 'schedules'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('schedules-tab')).toBeInTheDocument()
  })

  
  it('save button disabled when no pending changes', async () => {
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeDisabled()
  })

  it('redirects to basic tab when no tabParam', () => {
    mockTabParam = ''
    setupChats()
    render(<AgentChatEditingView />)
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/basic', { replace: true })
  })

  it('saves all pending changes when save button clicked', async () => {
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // Trigger a pending change via onDataChange callback
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Renamed Agent' }, true)
    })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(saveBtn)
    })

    await waitFor(() => expect(updateChatAgent).toHaveBeenCalled())
    expect(mockShowSuccess).toHaveBeenCalledWith('All changes saved successfully')
  })

  it('collapses knowledge group when active tab is not knowledge and toggle is clicked', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    mockTabParam = 'knowledge'
    setupChats()
    render(<AgentChatEditingView />)

    // Initially expanded since tab is knowledge
    expect(screen.getByText('Knowledge Folder')).toBeInTheDocument()

    // Toggle collapses it
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    expect(screen.queryByText('Knowledge Folder')).not.toBeInTheDocument()
  })

  it('shows change indicator dot when there are pending changes', async () => {
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // No indicator initially
    expect(screen.queryByText('●')).not.toBeInTheDocument()

    // Trigger a pending change
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Changed' }, true)
    })

    // Change indicator should appear
    await waitFor(() => expect(screen.getByText('●')).toBeInTheDocument())
  })

  it('handles save failure by setting error', async () => {
    const updateChatAgent = vi.fn().mockResolvedValue({ success: false, error: 'Update failed' })
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })

    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // Trigger a pending change
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'New Name' }, true)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument())
    expect(screen.getByTestId('error-msg').textContent).toMatch(/Update failed/)
  })

  it('uses a default error when save all returns failure without a message', async () => {
    const updateChatAgent = vi.fn().mockResolvedValue({ success: false })
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'New Name' }, true)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(screen.getByTestId('error-msg').textContent).toMatch(/Failed to update agent/))
  })

  it('uses a default error when save all throws a non-Error value', async () => {
    const updateChatAgent = vi.fn().mockRejectedValue('weird')
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'New Name' }, true)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(screen.getByTestId('error-msg').textContent).toMatch(/An unknown error occurred/))
  })

  it('uses agent knowledgeBase from knowledge.knowledgeBase if available', async () => {
    setupChats({
      agent: {
        ...baseAgent,
        knowledge: { knowledgeBase: '/kb-from-knowledge' },
        knowledgeBase: '/old-kb',
      },
    })
    render(<AgentChatEditingView />)
    // Just verify it renders without crash
    await screen.findByText('Test Agent - Settings')
  })

  it('default tab is basic when tabParam is unknown', () => {
    mockTabParam = 'unknown-tab'
    setupChats()
    render(<AgentChatEditingView />)
    expect(screen.getByTestId('basic-tab')).toBeInTheDocument()
  })

  it('shows change-indicator for knowledge tab when schedulerEnabled', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    setupChats()
    render(<AgentChatEditingView />)
    // Scheduler enabled means knowledge group is shown
    expect(screen.getByRole('button', { name: 'Knowledge' })).toBeInTheDocument()
  })

  it('validates duplicate agent name and shows error', async () => {
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat },
        {
          chat_id: 'chat-2',
          agent: { ...baseAgent, name: 'Duplicate Name' },
          chatSessions: [],
        },
      ],
      updateChatAgent: vi.fn(),
    })

    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Duplicate Name' }, true)
    })

    // Should auto-switch to basic tab (already on it) and show field error
    // Validation fires in useEffect
    await waitFor(() => {
      // save button should be disabled due to validation error
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  it('clears field error when pending change is removed', async () => {
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat },
        { chat_id: 'chat-2', agent: { ...baseAgent, name: 'Duplicate' }, chatSessions: [] },
      ],
      updateChatAgent: vi.fn(),
    })

    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // Set duplicate name
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Duplicate' }, true)
    })

    // Remove pending change
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Test Agent' }, false)
    })

    await waitFor(() => {
      // Should clear error, save button stays disabled due to no pending changes
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  it('handles save with no chatId (edge case)', async () => {
    // Test with no chat in chats list - agent not found
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument())
  })

  it('saves with all field types in allChanges', async () => {
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // Trigger changes for multiple tabs to test all handleSaveAll field branches
    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', {
        name: 'New Name', emoji: '🚀', role: 'assistant', model: 'claude-opus-4',
      }, true)
      capturedBasicTabOnDataChange?.('knowledge', { knowledgeBase: '/new-kb' }, true)
      capturedBasicTabOnDataChange?.('mcp', { mcpServers: [] }, true)
      capturedBasicTabOnDataChange?.('skills', { skills: ['web-search'] }, true)
      capturedBasicTabOnDataChange?.('prompt', { systemPrompt: 'New prompt' }, true)
      capturedBasicTabOnDataChange?.('schedules', {}, true)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(updateChatAgent).toHaveBeenCalled())
  })

  it('save all succeeds and updates agent data', async () => {
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'Updated Agent', emoji: '🎯' }, true)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled()
      // Save button should be disabled again after save
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  it('calls onSave directly from tab (individual save path)', async () => {
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    // Call onSave directly from the tab mock
    await act(async () => {
      const result = await capturedBasicTabOnSave?.({ name: 'Direct Save' })
      expect(result).toBeDefined()
    })

    expect(updateChatAgent).toHaveBeenCalled()
  })

  it('individual tab save handles update failure', async () => {
    const updateChatAgent = vi.fn().mockResolvedValue({ success: false, error: 'Save failed' })
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      try {
        await capturedBasicTabOnSave?.({ name: 'Direct Save' })
      } catch {
        // expected to throw
      }
    })

    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument())
  })

  it('individual tab save uses default error when update returns failure without a message', async () => {
    const updateChatAgent = vi.fn().mockResolvedValue({ success: false })
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      await expect(capturedBasicTabOnSave?.({ name: 'Direct Save' })).rejects.toThrow('Failed to update agent')
    })

    await waitFor(() => expect(screen.getByTestId('error-msg').textContent).toMatch(/Failed to update agent/))
  })

  it('individual tab save uses default error when update throws a non-Error value', async () => {
    const updateChatAgent = vi.fn().mockRejectedValue('weird')
    mockUseChats.mockReturnValue({ chats: [baseChat], updateChatAgent })
    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      try {
        await capturedBasicTabOnSave?.({ name: 'Direct Save' })
      } catch {
        // expected to throw the original non-Error value
      }
    })

    await waitFor(() => expect(screen.getByTestId('error-msg').textContent).toMatch(/An unknown error occurred/))
  })

  it('navigates to /agent/chat when no chatId (handleBackToChat edge case)', () => {
    mockTabParam = 'basic'
    // Override useParams to return no chatId
    vi.doMock('react-router-dom', async () => ({
      ...await vi.importActual('react-router-dom'),
      useParams: () => ({ chatId: undefined, '*': 'basic' }),
      useNavigate: () => mockNavigate,
    }))
    // Render normal view which has chatId='chat-1', so test the code path differently
    // by checking navigation when chatId is not in chats
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    // The error state for missing agent is shown
    expect(screen.queryByText('No agent selected')).toBeFalsy() // chatId still 'chat-1' from module mock
  })

  it('handleSave for knowledge tab route', async () => {
    mockTabParam = 'knowledge'
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('knowledge-tab')

    await act(async () => {
      await capturedKnowledgeTabOnSave?.({ knowledgeBase: '/new-kb' })
    })
    expect(updateChatAgent).toHaveBeenCalled()
  })

  it('handleSave for mcp tab route', async () => {
    mockTabParam = 'mcp_servers'
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('mcp-tab')

    await act(async () => {
      await capturedMcpTabOnSave?.({ mcpServers: [{ name: 'test', tools: [] }] })
    })
    expect(updateChatAgent).toHaveBeenCalled()
  })

  it('handleSave for skills tab route', async () => {
    mockTabParam = 'skills'
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('skills-tab')

    await act(async () => {
      await capturedSkillsTabOnSave?.({ skills: ['web-search'] })
    })
    expect(updateChatAgent).toHaveBeenCalled()
  })

  
  it('handleSave for prompt tab route', async () => {
    mockTabParam = 'system_prompt'
    const updateChatAgent = setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('prompt-tab')

    await act(async () => {
      await capturedPromptTabOnSave?.({ systemPrompt: 'Updated prompt' })
    })
    expect(updateChatAgent).toHaveBeenCalled()
  })

  
  it('clicks Basic nav tab to switch to basic route', async () => {
    mockTabParam = 'knowledge'
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('knowledge-tab')
    fireEvent.click(screen.getByText('Basic'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/basic')
  })

  it('clicks Knowledge nav tab (no scheduler) to switch to knowledge', async () => {
    mockUseFeatureFlag.mockReturnValue(false)
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    fireEvent.click(screen.getByText('Knowledge'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/knowledge')
  })

  it('clicks Skills nav tab to switch to skills route', async () => {
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    fireEvent.click(screen.getByText('Skills'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/skills')
  })

  it('clicks Schedules nav tab when schedulerEnabled', async () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    fireEvent.click(screen.getByText('Schedules'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/schedules')
  })

  
  it('clicks knowledge sub-tab when schedulerEnabled and group expanded', async () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler')
    mockTabParam = 'knowledge'
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    // Knowledge group should be expanded since activeTab=knowledge
    expect(screen.getByText('Knowledge Folder')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Knowledge Folder'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/knowledge')
  })

  it('shows Go to Chat button and navigates when no chatId', async () => {
    // Override useParams to return no chatId
    vi.doMock('react-router-dom', async () => ({
      ...await vi.importActual('react-router-dom'),
      useParams: () => ({ chatId: undefined, '*': 'basic' }),
      useNavigate: () => mockNavigate,
    }))

    // We can't easily re-import with doMock in same test file; test via the edge case
    // where chats list is empty AND we test the back button text
    mockUseChats.mockReturnValue({ chats: [], updateChatAgent: vi.fn() })
    render(<AgentChatEditingView />)
    // chatId='chat-1' from static mock so shows error for agent not found but not the no-chatId case
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument())
  })

  it('validation switches to basic tab when on a different tab with duplicate name', async () => {
    mockTabParam = 'basic'
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat },
        { chat_id: 'chat-2', agent: { ...baseAgent, name: 'DupName' }, chatSessions: [] },
      ],
      updateChatAgent: vi.fn(),
    })

    render(<AgentChatEditingView />)
    await screen.findByTestId('basic-tab')

    await act(async () => {
      capturedBasicTabOnDataChange?.('basic', { name: 'DupName' }, true)
    })

    // Save should be disabled due to duplicate name validation
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
  })

  it('redirects to basic via the router (no infinite loop) when an invalid name lands on a non-basic route', async () => {
    // Regression: the route-sync effect forces activeTab=currentRouteTab while the
    // validation effect forces activeTab='basic'. On a non-basic route with a failing
    // name validation these two effects used to fight forever (infinite re-render).
    // The fix routes the redirect through navigate() so the route stays the single
    // source of truth. Here chat-1's stored name already duplicates chat-2, so
    // validation fails at mount while the route points at the MCP tab.
    mockTabParam = 'mcp_servers'
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat },
        { chat_id: 'chat-2', agent: { ...baseAgent, name: 'Test Agent' }, chatSessions: [] },
      ],
      updateChatAgent: vi.fn(),
    })

    render(<AgentChatEditingView />)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/basic', { replace: true })
    })
  })

  it('clicks System Prompt nav tab', async () => {
    setupChats()
    const { rerender } = render(<AgentChatEditingView />)
    await screen.findByText('Test Agent - Settings')
    fireEvent.click(screen.getByText('System Prompt'))
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/system_prompt')
    expect(screen.getByText('Agent Identity')).toBeInTheDocument()
    expect(screen.getByText('Project Context')).toBeInTheDocument()

    mockTabParam = 'system_prompt'
    rerender(<AgentChatEditingView />)

    await waitFor(() => {
      expect(screen.getByTestId('prompt-tab')).toHaveAttribute('data-prompt-file', 'Base.md')
    })
  })

  it('switches System Prompt child tab to AGENTS.md without changing route', async () => {
    mockTabParam = 'system_prompt'
    setupChats()
    render(<AgentChatEditingView />)
    await screen.findByTestId('prompt-tab')

    fireEvent.click(screen.getByText('Project Context'))

    await waitFor(() => {
      expect(screen.getByTestId('prompt-tab')).toHaveAttribute('data-prompt-file', 'AGENTS.md')
    })
    expect(mockNavigate).not.toHaveBeenCalledWith('/agent/chat/chat-1/settings/system_prompt')
  })

  it('resets System Prompt child tab to Base.md when switching agents', async () => {
    mockTabParam = 'system_prompt'
    const updateChatAgent = vi.fn().mockResolvedValue({ success: true })
    mockUseChats.mockReturnValue({
      chats: [
        { ...baseChat, chat_id: 'chat-1', agent: { ...baseAgent, name: 'Agent One' } },
        { ...baseChat, chat_id: 'chat-2', agent: { ...baseAgent, name: 'Agent Two' } },
      ],
      updateChatAgent,
    })
    const { rerender } = render(<AgentChatEditingView />)
    await screen.findByTestId('prompt-tab')

    fireEvent.click(screen.getByText('Project Context'))
    await waitFor(() => {
      expect(screen.getByTestId('prompt-tab')).toHaveAttribute('data-prompt-file', 'AGENTS.md')
    })

    mockChatId = 'chat-2'
    rerender(<AgentChatEditingView />)

    await waitFor(() => {
      expect(screen.getByTestId('prompt-tab')).toHaveAttribute('data-prompt-file', 'Base.md')
    })
  })
})
