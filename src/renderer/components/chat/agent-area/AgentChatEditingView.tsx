import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import '../../../styles/Agent.css'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import AgentKnowledgeBaseTab from '../agent-editor/AgentKnowledgeBaseTab'
import AgentMcpServersTab from '../agent-editor/AgentMcpServersTab'
import AgentSkillsTab from '../agent-editor/AgentSkillsTab'
import AgentSchedulesTab from '../agent-editor/AgentSchedulesTab'
import AgentSubAgentsTab from '../agent-editor/AgentSubAgentsTab'
import AgentSystemPromptTab from '../agent-editor/AgentSystemPromptTab'
import AgentPluginsTab from '../agent-editor/AgentPluginsTab'
import ErrorHandler from '../agent-editor/ErrorHandler'
import { TabState, AgentConfig, AgentEditorTabName } from '../agent-editor/types'
import { useChats, useProfileData } from '../../userData/userDataProvider'
import { ChatConfig, ChatAgent } from '../../../lib/userData/types'
import { useToast } from '../../ui/ToastProvider'
import { useFeatureFlag } from '../../../lib/featureFlags'
import { createLogger } from '../../../lib/utilities/logger'

const logger = createLogger('[AgentChatEditingView]')

const getAgentKnowledge = (agent?: ChatAgent | null) => ({
  knowledgeBase: agent?.knowledge?.knowledgeBase ?? agent?.knowledgeBase,
})

/**
 * AgentChatEditingView - Agent editing view component
 *
 * Routes:
 *   - /agent/chat/:chatId/settings (defaults to redirecting to basic)
 *   - /agent/chat/:chatId/settings/basic
 *   - /agent/chat/:chatId/settings/mcp_servers
 *   - /agent/chat/:chatId/settings/skills
 *   - /agent/chat/:chatId/settings/schedules
 *   - /agent/chat/:chatId/settings/system_prompt
 *
 * This component was refactored from AgentChatEditor (modal overlay),
 * and now renders as a normal View component in the main content area.
 *
 * Features:
 * - Loads Agent config and Tab based on URL params chatId and tab
 * - Provides multi-Tab editing interface (Basic, MCP Servers, Skills, Schedules, System Prompt)
 * - Supports change tracking and batch saving
 * - Supports Tab-level URL routing
 */
const AgentChatEditingView: React.FC = () => {
  const { chatId, '*': tabParam } = useParams<{ chatId: string; '*': string }>()
  const navigate = useNavigate()

  // Use ProfileDataProvider hooks
  const { chatOps } = useProfileData()
  const { chats, updateChat } = useChats()
  const { showSuccess, showError } = useToast()

  // Tab route mapping
  const tabRouteMap = {
    'basic': 'basic',
    'knowledge': 'knowledge',
    'mcp_servers': 'mcp',
    'skills': 'skills',
    'plugins': 'plugins',
    'schedules': 'schedules',
    'sub_agents': 'sub_agents',
    'system_prompt': 'prompt',
  } as const

  // Reverse mapping - from internal tab name to route
  const tabToRouteMap = {
    'basic': 'basic',
    'knowledge': 'knowledge',
    'mcp': 'mcp_servers',
    'skills': 'skills',
    'plugins': 'plugins',
    'schedules': 'schedules',
    'sub_agents': 'sub_agents',
    'prompt': 'system_prompt',
  } as const

  // Get current tab from URL, default to basic
  const getCurrentTabFromUrl = (): AgentEditorTabName => {
    if (!tabParam) return 'basic'
    const mappedTab = tabRouteMap[tabParam as keyof typeof tabRouteMap]
    return mappedTab || 'basic'
  }

  // Tab state management - all tabs enabled by default in edit mode
  const [tabState, setTabState] = useState<TabState>({
    activeTab: getCurrentTabFromUrl(),
    tabsEnabled: {
      basic: true,
      knowledge: true,
      mcp: true,
      skills: true,
      plugins: true,
      schedules: true,
      sub_agents: true,
      prompt: true,
    },
    agentCreated: true // Agent already exists in edit mode
  })

  // Agent data state
  const [agentData, setAgentData] = useState<AgentConfig | undefined>(undefined)

  // Error handling state
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Sub-Agent feature controlled by feature flag
  const subAgentEnabled = useFeatureFlag('openkosmosFeatureSubAgent')
  const schedulerEnabled = useFeatureFlag('openkosmosFeatureScheduler')
  const showKnowledgeSourcesGroup = schedulerEnabled

  // Field-level error state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Key for force-resetting Tab component states
  const [tabResetKey, setTabResetKey] = useState(0)
  const [isKnowledgeGroupExpanded, setIsKnowledgeGroupExpanded] = useState(
    getCurrentTabFromUrl() === 'knowledge'
  )

  const readOnlyFlags = {
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    schedules: false,
    sub_agents: false,
    prompt: false,
  }

  // Change tracking state - records whether each Tab has unsaved changes
  const [pendingChanges, setPendingChanges] = useState<{
    basic: boolean
    knowledge: boolean
    mcp: boolean
    skills: boolean
    plugins: boolean
    schedules: boolean
    sub_agents: boolean
    prompt: boolean
  }>({
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    plugins: false,
    schedules: false,
    sub_agents: false,
    prompt: false,
  })
  const [tabChangesCache, setTabChangesCache] = useState<{
    basic: Partial<AgentConfig> | null
    knowledge: Partial<AgentConfig> | null
    mcp: Partial<AgentConfig> | null
    skills: Partial<AgentConfig> | null
    plugins: Partial<AgentConfig> | null
    schedules: Partial<AgentConfig> | null
    sub_agents: Partial<AgentConfig> | null
    prompt: Partial<AgentConfig> | null
  }>({
    basic: null,
    knowledge: null,
    mcp: null,
    skills: null,
    plugins: null,
    schedules: null,
    sub_agents: null,
    prompt: null,
  })

  // watch URL param changes and update activeTab
  useEffect(() => {
    const urlTab = getCurrentTabFromUrl()
    if (tabState.activeTab !== urlTab) {
      setTabState(prev => ({ ...prev, activeTab: urlTab }))
    }
  }, [tabParam, tabState.activeTab])

  useEffect(() => {
    setIsKnowledgeGroupExpanded(tabState.activeTab === 'knowledge')
  }, [tabState.activeTab])

  // Load agent data
  useEffect(() => {
    if (chatId) {
      const chat = chats.find(c => c.chat_id === chatId)
      if (chat && chat.agent) {
        const knowledge = getAgentKnowledge(chat.agent)
        const agentConfig: AgentConfig = {
          id: chat.chat_id,
          name: chat.agent.name,
          emoji: chat.agent.emoji,
          avatar: chat.agent.avatar, // Agent avatar URL
          role: chat.agent.role,
          model: chat.agent.model,
          workspace: chat.agent.workspace,
          knowledgeBase: knowledge.knowledgeBase,
          version: chat.agent.version,
          source: chat.agent.source,
          mcpServers: chat.agent.mcp_servers,
          systemPrompt: chat.agent.system_prompt,
          skills: chat.agent.skills,
          enabledPlugins: chat.agent.enabled_plugins,
          subAgents: chat.agent.sub_agents,
          authToken: chat.agent.authToken,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        setAgentData(agentConfig)
      } else {
        // Agent not found, show error or redirect
        logger.error('[AgentChatEditingView] Agent not found for chatId:', chatId)
        setError('Agent not found')
      }
    }
  }, [chatId, chats])

  // Reset tabs when enabledPlugins changes (plugin toggle writes directly to backend)
  const prevEnabledPluginsRef = useRef<string[] | undefined>(agentData?.enabledPlugins)
  useEffect(() => {
    const prev = prevEnabledPluginsRef.current
    const curr = agentData?.enabledPlugins
    if (JSON.stringify(prev) !== JSON.stringify(curr)) {
      prevEnabledPluginsRef.current = curr
      if (prev !== undefined) {
        setTabChangesCache({
          basic: null, knowledge: null, mcp: null, skills: null,
          plugins: null, schedules: null, sub_agents: null, prompt: null,
        })
        setPendingChanges({
          basic: false, knowledge: false, mcp: false, skills: false,
          plugins: false, schedules: false, sub_agents: false, prompt: false,
        })
        setTabResetKey(prev => prev + 1)
      }
    }
  }, [agentData?.enabledPlugins])

  // Callback for handling Tab modification state changes
  const handleTabDataChange = useCallback((tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => {
    setPendingChanges(prev => ({
      ...prev,
      [tabName]: hasChanges
    }))

    setTabChangesCache(prev => ({
      ...prev,
      [tabName]: hasChanges ? data : null
    }))
  }, [])

  // Validate all pending changes
  const validateAllChanges = useCallback(() => {
    const allChanges: Partial<AgentConfig> = {}

    if (pendingChanges.basic && tabChangesCache.basic) {
      Object.assign(allChanges, tabChangesCache.basic)
    }
    if (pendingChanges.knowledge && tabChangesCache.knowledge) {
      Object.assign(allChanges, tabChangesCache.knowledge)
    }
    if (pendingChanges.mcp && tabChangesCache.mcp) {
      Object.assign(allChanges, tabChangesCache.mcp)
    }
    if (pendingChanges.skills && tabChangesCache.skills) {
      Object.assign(allChanges, tabChangesCache.skills)
    }
    if (pendingChanges.sub_agents && tabChangesCache.sub_agents) {
      Object.assign(allChanges, tabChangesCache.sub_agents)
    }
    if (pendingChanges.prompt && tabChangesCache.prompt) {
      Object.assign(allChanges, tabChangesCache.prompt)
    }

    // Agent Name validation - check for duplicate names
    const currentName = allChanges.name || agentData?.name

    if (currentName && currentName.trim() !== '') {
      const existingAgent = chats.find(chat =>
        chat.agent &&
        chat.agent.name === currentName.trim() &&
        chat.chat_id !== chatId
      )

      if (existingAgent) {
        return { isValid: false, errorMessage: `Agent name "${currentName.trim()}" already exists. Please choose a different name.`, showError: true }
      }
    }

    return { isValid: true, errorMessage: null, showError: false }
  }, [pendingChanges, tabChangesCache, agentData, chatId, chats])

  // Check if there are any pending changes
  const hasAnyPendingChanges = Object.values(pendingChanges).some(hasChange => hasChange)

  // Check if save is possible (has changes and validation passes)
  const validationResult = validateAllChanges()
  const canSaveAll = hasAnyPendingChanges && validationResult.isValid

  // Use useEffect to update field errors
  useEffect(() => {
    const { isValid, errorMessage, showError: shouldShowError } = validationResult

    if (!isValid && shouldShowError && errorMessage) {
      if (fieldErrors.name !== errorMessage) {
        setFieldErrors({ name: errorMessage })
      }
      if (tabState.activeTab !== 'basic') {
        setTabState(prev => ({ ...prev, activeTab: 'basic' }))
      }
    } else {
      if (fieldErrors.name) {
        setFieldErrors({})
      }
    }
  }, [validationResult.isValid, validationResult.errorMessage, validationResult.showError, fieldErrors.name, tabState.activeTab])

  // Tab switch handler - update URL route
  const handleTabSwitch = useCallback((tab: AgentEditorTabName) => {
    if (tabState.tabsEnabled[tab] && chatId) {
      const routeTab = tabToRouteMap[tab]
      navigate(`/agent/chat/${chatId}/settings/${routeTab}`)
    }
  }, [tabState.tabsEnabled, chatId, navigate])

  const handleKnowledgeGroupToggle = useCallback(() => {
    const nextExpanded = !isKnowledgeGroupExpanded

    setIsKnowledgeGroupExpanded(nextExpanded)

    if (nextExpanded && chatId && tabState.activeTab !== 'knowledge') {
      navigate(`/agent/chat/${chatId}/settings/knowledge`)
    }
  }, [chatId, isKnowledgeGroupExpanded, navigate, tabState.activeTab])

  // Clear error
  const handleClearError = useCallback(() => {
    setError(null)
  }, [])

  // Data save handler - strictly isolate data by Tab
  const handleSave = useCallback(async (data: Partial<AgentConfig>): Promise<AgentConfig> => {
    setError(null)
    setIsLoading(true)

    try {
      if (!chatId) {
        throw new Error('No chat ID found for update operation')
      }

      const chat = chats.find(c => c.chat_id === chatId)
      if (!chat || !chat.agent) {
        throw new Error('Agent not found')
      }

      // Start from existing data, only update fields for the current Tab
      const updateData: ChatAgent = { ...chat.agent }
      updateData.knowledge = {
        knowledgeBase: chat.agent.knowledge?.knowledgeBase ?? chat.agent.knowledgeBase ?? '',
      }

      // Only update fields corresponding to current Tab
      if (tabState.activeTab === 'basic') {
        if (data.name !== undefined) updateData.name = data.name // 🆕 Support ON-DEVICE agent renaming
        if (data.emoji !== undefined) updateData.emoji = data.emoji
        if (data.role !== undefined) updateData.role = data.role
        if (data.model !== undefined) updateData.model = data.model
      } else if (tabState.activeTab === 'knowledge') {
        if (data.knowledgeBase !== undefined) updateData.knowledge!.knowledgeBase = data.knowledgeBase
      } else if (tabState.activeTab === 'mcp') {
        if (data.mcpServers !== undefined) {
          updateData.mcp_servers = data.mcpServers
        }
      } else if (tabState.activeTab === 'skills') {
        if (data.skills !== undefined) {
          updateData.skills = data.skills
        }
      } else if (tabState.activeTab === 'sub_agents') {
        if (data.subAgents !== undefined) {
          updateData.sub_agents = data.subAgents
        }
      } else if (tabState.activeTab === 'prompt') {
        if (data.systemPrompt !== undefined) {
          updateData.system_prompt = data.systemPrompt
        }
      }

      const result = await updateChat(chatId, {
        agent: updateData
      })

      if (result.success) {
        const persistedKnowledge = getAgentKnowledge(chat.agent)
        const currentAgentData = agentData || {
          id: chatId,
          name: chat.agent.name,
          emoji: chat.agent.emoji,
          role: chat.agent.role,
          model: chat.agent.model,
          workspace: chat.agent.workspace,
          knowledgeBase: persistedKnowledge.knowledgeBase,
          version: chat.agent.version,
          source: chat.agent.source,
          mcpServers: chat.agent.mcp_servers,
          systemPrompt: chat.agent.system_prompt,
          createdAt: new Date(),
          updatedAt: new Date()
        }

        const updatedAgent: AgentConfig = { ...currentAgentData }

        if (tabState.activeTab === 'mcp') {
          updatedAgent.mcpServers = data.mcpServers !== undefined ? data.mcpServers : currentAgentData.mcpServers
        } else if (tabState.activeTab === 'skills') {
          updatedAgent.skills = data.skills !== undefined ? data.skills : currentAgentData.skills
        } else if (tabState.activeTab === 'sub_agents') {
          updatedAgent.subAgents = data.subAgents !== undefined ? data.subAgents : currentAgentData.subAgents
        } else if (tabState.activeTab === 'prompt') {
          updatedAgent.systemPrompt = data.systemPrompt !== undefined ? data.systemPrompt : currentAgentData.systemPrompt
        } else if (tabState.activeTab === 'knowledge') {
          if (data.knowledgeBase !== undefined) updatedAgent.knowledgeBase = data.knowledgeBase
        } else if (tabState.activeTab === 'basic') {
          if (data.name !== undefined) updatedAgent.name = data.name // 🆕 Support ON-DEVICE agent renaming
          if (data.emoji !== undefined) updatedAgent.emoji = data.emoji
          if (data.role !== undefined) updatedAgent.role = data.role
          if (data.model !== undefined) updatedAgent.model = data.model
        }

        updatedAgent.updatedAt = new Date()
        setAgentData(updatedAgent)

        return updatedAgent
      } else {
        throw new Error(result.error || 'Failed to update agent')
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
      setError(`Failed to save: ${errorMessage}`)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [tabState, agentData, chatId, updateChat, chats])

  // Unified save-all function
  const handleSaveAll = useCallback(async () => {
    if (!canSaveAll) return

    setIsLoading(true)
    setError(null)

    try {
      // Collect all pending changes
      const allChanges: Partial<AgentConfig> = {}

      if (pendingChanges.basic && tabChangesCache.basic) {
        Object.assign(allChanges, tabChangesCache.basic)
      }
      if (pendingChanges.knowledge && tabChangesCache.knowledge) {
        Object.assign(allChanges, tabChangesCache.knowledge)
      }
      if (pendingChanges.mcp && tabChangesCache.mcp) {
        Object.assign(allChanges, tabChangesCache.mcp)
      }
      if (pendingChanges.skills && tabChangesCache.skills) {
        Object.assign(allChanges, tabChangesCache.skills)
      }
      if (pendingChanges.sub_agents && tabChangesCache.sub_agents) {
        Object.assign(allChanges, tabChangesCache.sub_agents)
      }
      if (pendingChanges.schedules && tabChangesCache.schedules) {
        Object.assign(allChanges, tabChangesCache.schedules)
      }
      if (pendingChanges.prompt && tabChangesCache.prompt) {
        Object.assign(allChanges, tabChangesCache.prompt)
      }

      if (!chatId) {
        throw new Error('No chat ID found for update operation')
      }

      const chat = chats.find(c => c.chat_id === chatId)
      if (!chat || !chat.agent) {
        throw new Error('Agent not found')
      }

      // Start from existing data, update all modified fields
      const updateData: ChatAgent = { ...chat.agent }
      updateData.knowledge = {
        knowledgeBase: chat.agent.knowledge?.knowledgeBase ?? chat.agent.knowledgeBase ?? '',
      }

      // Update all modified fields
      if (allChanges.name !== undefined) updateData.name = allChanges.name // 🆕 Support ON-DEVICE agent renaming
      if (allChanges.emoji !== undefined) updateData.emoji = allChanges.emoji
      if (allChanges.role !== undefined) updateData.role = allChanges.role
      if (allChanges.model !== undefined) updateData.model = allChanges.model
      if (allChanges.knowledgeBase !== undefined) updateData.knowledge.knowledgeBase = allChanges.knowledgeBase
      if (allChanges.mcpServers !== undefined) updateData.mcp_servers = allChanges.mcpServers
      if (allChanges.skills !== undefined) updateData.skills = allChanges.skills
      if (allChanges.subAgents !== undefined) updateData.sub_agents = allChanges.subAgents
      if (allChanges.systemPrompt !== undefined) updateData.system_prompt = allChanges.systemPrompt

      const result = await updateChat(chatId, {
        agent: updateData
      })

      if (result.success) {
        // Update local agent data
        const updatedAgent: AgentConfig = {
          id: chatId,
          name: updateData.name,
          emoji: updateData.emoji,
          role: updateData.role,
          model: updateData.model,
          workspace: updateData.workspace,
          knowledgeBase: updateData.knowledge?.knowledgeBase,
          version: updateData.version,
          source: updateData.source,
          mcpServers: updateData.mcp_servers,
          systemPrompt: updateData.system_prompt,
          skills: updateData.skills,
          enabledPlugins: updateData.enabled_plugins,
          subAgents: updateData.sub_agents,
          createdAt: agentData?.createdAt || new Date(),
          updatedAt: new Date()
        }

        setAgentData(updatedAgent)
      } else {
        throw new Error(result.error || 'Failed to update agent')
      }

      // Clear all modification states
      setPendingChanges({
        basic: false,
        knowledge: false,
        mcp: false,
        skills: false,
        plugins: false,
        schedules: false,
        sub_agents: false,
        prompt: false,
      })
      setTabChangesCache({
        basic: null,
        knowledge: null,
        mcp: null,
        skills: null,
        plugins: null,
        schedules: null,
        sub_agents: null,
        prompt: null,
      })

      // Force remount all Tab components
      setTabResetKey(prev => prev + 1)

      showSuccess('All changes saved successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
      setError(`Failed to save: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [canSaveAll, pendingChanges, tabChangesCache, chatId, agentData, updateChat, chats, showSuccess])

  // Navigate back to chat page
  const handleBackToChat = useCallback(() => {
    if (!chatId) {
      navigate('/agent/chat')
      return
    }

    const targetChat = chats.find(chat => chat.chat_id === chatId)
    const hasExistingSessions = Boolean(targetChat?.chatSessions?.length)

    if (!hasExistingSessions) {
      navigate(`/agent/chat/${chatId}`, {
        state: {
          intent: 'new-chat',
          source: 'agent-settings-back'
        }
      })
      return
    }

    navigate(`/agent/chat/${chatId}`)
  }, [chatId, chats, navigate])

  // Handle default route redirect - if URL has no tab param, redirect to basic
  useEffect(() => {
    if (chatId && !tabParam) {
      navigate(`/agent/chat/${chatId}/settings/basic`, { replace: true })
    }
  }, [chatId, tabParam, navigate])

  // If no chatId, show error
  if (!chatId) {
    return (
      <div className="agent-editing-view-error">
        <p>No agent selected. Please select an agent from the left navigation.</p>
        <button onClick={() => navigate('/agent/chat')}>Go to Chat</button>
      </div>
    )
  }

  return (
    <div className="agent-editing-view">
      {/* Header */}
      <header className="unified-header">
        <div className="header-title">
          <button
            className="btn-action"
            onClick={handleBackToChat}
            title="Back to Chat"
            style={{ marginRight: '8px' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="header-name">
           {agentData ? `${agentData.name} - Settings` : 'Agent Settings'}
         </span>
        </div>
        <div className="header-actions">
          {/* Save button - shows warning red when there are unsaved changes */}
          <button
            className={`btn-save ${canSaveAll ? 'has-changes' : ''}`}
            onClick={handleSaveAll}
            disabled={isLoading || !canSaveAll}
            title={
              isLoading
                ? 'Saving...'
                : canSaveAll
                  ? 'Save All Changes'
                  : 'No Changes to Save'
            }
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '6px',
              border: 'none',
              cursor: canSaveAll && !isLoading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              backgroundColor: canSaveAll ? '#dc2626' : '#e5e7eb',
              color: canSaveAll ? 'white' : '#9ca3af',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
       </div>
     </header>


     {/* Content */}
     <div className="agent-editing-view-content">
       {/* Error Display */}
       {error && (
          <div className="agent-editing-view-error-banner">
            <ErrorHandler
              error={error}
              onDismiss={handleClearError}
            />
          </div>
        )}

        {/* Left Navigation */}
        <div className="agent-editing-view-navigation">
          <div
            className={`nav-tab ${tabState.activeTab === 'basic' ? 'active' : ''} ${tabState.tabsEnabled.basic ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('basic')}
          >
            Basic
            {pendingChanges.basic && <span className="change-indicator">●</span>}
          </div>
          {showKnowledgeSourcesGroup ? (
            <div className="nav-group">
              <button
                type="button"
                className={`nav-tab nav-group-trigger ${tabState.activeTab === 'knowledge' ? 'active' : ''}`}
                onClick={handleKnowledgeGroupToggle}
              >
                <span className="nav-group-label">
                  <span>Knowledge</span>
                </span>
                {(pendingChanges.knowledge) && <span className="change-indicator">●</span>}
              </button>
              {isKnowledgeGroupExpanded && (
                <div className="nav-group-children">
                  <button
                    type="button"
                    className={`nav-tab nav-sub-tab ${tabState.activeTab === 'knowledge' ? 'active' : ''} ${tabState.tabsEnabled.knowledge ? '' : 'disabled'}`}
                    onClick={() => handleTabSwitch('knowledge')}
                  >
                    <span>Knowledge Folder</span>
                    {pendingChanges.knowledge && <span className="change-indicator">●</span>}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`nav-tab ${tabState.activeTab === 'knowledge' ? 'active' : ''} ${tabState.tabsEnabled.knowledge ? '' : 'disabled'}`}
              onClick={() => handleTabSwitch('knowledge')}
            >
              Knowledge
              {pendingChanges.knowledge && <span className="change-indicator">●</span>}
            </div>
          )}
          <div
            className={`nav-tab ${tabState.activeTab === 'mcp' ? 'active' : ''} ${tabState.tabsEnabled.mcp ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('mcp')}
          >
            MCP Servers
            {pendingChanges.mcp && <span className="change-indicator">●</span>}
          </div>
          <div
            className={`nav-tab ${tabState.activeTab === 'skills' ? 'active' : ''} ${tabState.tabsEnabled.skills ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('skills')}
          >
            Skills
            {pendingChanges.skills && <span className="change-indicator">●</span>}
          </div>
          <div
            className={`nav-tab ${tabState.activeTab === 'plugins' ? 'active' : ''} ${tabState.tabsEnabled.plugins ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('plugins')}
          >
            Plugins
          </div>
          {schedulerEnabled && (
            <div
              className={`nav-tab ${tabState.activeTab === 'schedules' ? 'active' : ''} ${tabState.tabsEnabled.schedules ? '' : 'disabled'}`}
              onClick={() => handleTabSwitch('schedules')}
            >
              Schedules
            </div>
          )}
          {subAgentEnabled && (
            <div
              className={`nav-tab ${tabState.activeTab === 'sub_agents' ? 'active' : ''} ${tabState.tabsEnabled.sub_agents ? '' : 'disabled'}`}
              onClick={() => handleTabSwitch('sub_agents')}
            >
              Sub-Agents
              {pendingChanges.sub_agents && <span className="change-indicator">●</span>}
            </div>
          )}
          <div
            className={`nav-tab ${tabState.activeTab === 'prompt' ? 'active' : ''} ${tabState.tabsEnabled.prompt ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('prompt')}
          >
            System Prompt
            {pendingChanges.prompt && <span className="change-indicator">●</span>}
          </div>
        </div>

        {/* Right Content Area */}
        <div className="agent-editing-view-main">
          {/* Loading Overlay */}
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner">🔄</div>
              <span className="loading-text">Saving...</span>
            </div>
          )}

          {/* Render only the selected Tab content based on active state */}
          {tabState.activeTab === 'basic' && (
            <AgentBasicTab
              key={`basic-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.basic}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.basic}
            />
          )}

          {tabState.activeTab === 'knowledge' && tabState.tabsEnabled.knowledge && (
            <AgentKnowledgeBaseTab
              key={`knowledge-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.knowledge}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.knowledge}
            />
          )}

          {tabState.activeTab === 'mcp' && tabState.tabsEnabled.mcp && (
            <AgentMcpServersTab
              key={`mcp-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.mcp}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.mcp}
            />
          )}

          {tabState.activeTab === 'skills' && tabState.tabsEnabled.skills && (
            <AgentSkillsTab
              key={`skills-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.skills}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.skills}
            />
          )}

          {tabState.activeTab === 'plugins' && tabState.tabsEnabled.plugins && (
            <AgentPluginsTab
              key={`plugins-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              readOnly={readOnlyFlags.skills}
            />
          )}

          {schedulerEnabled && tabState.activeTab === 'schedules' && tabState.tabsEnabled.schedules && (
            <AgentSchedulesTab
              key={`schedules-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.schedules}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.schedules}
            />
          )}

          {subAgentEnabled && tabState.activeTab === 'sub_agents' && tabState.tabsEnabled.sub_agents && (
            <AgentSubAgentsTab
              key={`sub_agents-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.sub_agents}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.sub_agents}
            />
          )}

          {tabState.activeTab === 'prompt' && tabState.tabsEnabled.prompt && (
            <AgentSystemPromptTab
              key={`prompt-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.prompt}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.prompt}
            />
          )}
        </div>
      </div>

    </div>
  )
}

export default AgentChatEditingView
