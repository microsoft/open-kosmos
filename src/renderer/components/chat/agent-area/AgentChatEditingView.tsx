import React, { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import '../../../styles/Agent.css'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import AgentKnowledgeBaseTab from '../agent-editor/AgentKnowledgeBaseTab'
import AgentMcpServersTab from '../agent-editor/AgentMcpServersTab'
import AgentSkillsTab from '../agent-editor/AgentSkillsTab'
import AgentSystemPromptTab from '../agent-editor/AgentSystemPromptTab'
import AgentContextEnhanceTab from '../agent-editor/AgentContextEnhanceTab'
import ErrorHandler from '../agent-editor/ErrorHandler'
import { TabState, AgentConfig } from '../agent-editor/types'
import { useChats, useProfileData } from '../../userData/userDataProvider'
import { ChatConfig, ChatAgent } from '../../../lib/userData/types'
import { useToast } from '../../ui/ToastProvider'
import { useFeatureFlag } from '../../../lib/featureFlags'

/**
 * AgentChatEditingView - Agent editing view component
 *
 * Routes:
 *   - /agent/chat/:chatId/settings (default redirect to basic)
 *   - /agent/chat/:chatId/settings/basic
 *   - /agent/chat/:chatId/settings/mcp_servers
 *   - /agent/chat/:chatId/settings/skills
 *   - /agent/chat/:chatId/settings/system_prompt
 *   - /agent/chat/:chatId/settings/context_enhancement
 *
 * This component is refactored from AgentChatEditor (modal overlay),
 * now rendered as a normal View component in the main content area.
 *
 * Features:
 * - Load corresponding Agent config and Tab based on URL params chatId and tab
 * - Provide multi-Tab editing interface (Basic, MCP Servers, Skills, System Prompt, Context Enhancement)
 * - Support change tracking and batch save
 * - Support Tab-level URL routing
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
    'system_prompt': 'prompt',
    'context_enhancement': 'context'
  } as const
  
  // Reverse mapping - from internal tab name to route
  const tabToRouteMap = {
    'basic': 'basic',
    'knowledge': 'knowledge',
    'mcp': 'mcp_servers',
    'skills': 'skills',
    'prompt': 'system_prompt',
    'context': 'context_enhancement'
  } as const
  
  // Get current tab from URL, default to basic
  const getCurrentTabFromUrl = (): 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context' => {
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
      prompt: true,
      context: true
    },
    agentCreated: true // Agent already exists in edit mode
  })

  // Agent data state
  const [agentData, setAgentData] = useState<AgentConfig | undefined>(undefined)
  
  // Error handling state
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  
  // Memory/Context Enhancement feature controlled by feature flag (Dev environment and non-Windows ARM)
  const memoryEnabled = useFeatureFlag('kosmosFeatureMemory')
  
  // Field-level error state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  
  // Key for forcing re-mount of all Tab components
  const [tabResetKey, setTabResetKey] = useState(0)
  
  // All fields are editable
  const readOnlyFlags = {
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    prompt: false,
    context: false
  }

  // Change tracking state - records whether each Tab has unsaved changes
  const [pendingChanges, setPendingChanges] = useState<{
    basic: boolean
    knowledge: boolean
    mcp: boolean
    skills: boolean
    prompt: boolean
    context: boolean
  }>({
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    prompt: false,
    context: false
  })

  // Cache modification data for each Tab
  const [tabChangesCache, setTabChangesCache] = useState<{
    basic: Partial<AgentConfig> | null
    knowledge: Partial<AgentConfig> | null
    mcp: Partial<AgentConfig> | null
    skills: Partial<AgentConfig> | null
    prompt: Partial<AgentConfig> | null
    context: Partial<AgentConfig> | null
  }>({
    basic: null,
    knowledge: null,
    mcp: null,
    skills: null,
    prompt: null,
    context: null
  })

  // URL route sync - listen for URL param changes and update activeTab
  useEffect(() => {
    const urlTab = getCurrentTabFromUrl()
    if (tabState.activeTab !== urlTab) {
      setTabState(prev => ({ ...prev, activeTab: urlTab }))
    }
  }, [tabParam, tabState.activeTab])

  // Load agent data
  useEffect(() => {
    if (chatId) {
      const chat = chats.find(c => c.chat_id === chatId)
      if (chat && chat.agent) {
        const agentConfig: AgentConfig = {
          id: chat.chat_id,
          name: chat.agent.name,
          emoji: chat.agent.emoji,
          avatar: chat.agent.avatar, // Agent avatar URL
          role: chat.agent.role,
          model: chat.agent.model,
          workspace: chat.agent.workspace,
          knowledgeBase: chat.agent.knowledgeBase,
          version: chat.agent.version,
          mcpServers: chat.agent.mcp_servers,
          systemPrompt: chat.agent.system_prompt,
          contextEnhancement: chat.agent.context_enhancement,
          skills: chat.agent.skills,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        setAgentData(agentConfig)
      } else {
        // Agent not found, show error or redirect
        console.error('[AgentChatEditingView] Agent not found for chatId:', chatId)
        setError('Agent not found')
      }
    }
  }, [chatId, chats])

  // Callback for handling Tab modification state changes
  const handleTabDataChange = useCallback((tabName: 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context', data: Partial<AgentConfig>, hasChanges: boolean) => {
    setPendingChanges(prev => ({
      ...prev,
      [tabName]: hasChanges
    }))
    
    setTabChangesCache(prev => ({
      ...prev,
      [tabName]: hasChanges ? data : null
    }))
  }, [])

  // Validate all pending save data
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
    if (pendingChanges.prompt && tabChangesCache.prompt) {
      Object.assign(allChanges, tabChangesCache.prompt)
    }
    if (pendingChanges.context && tabChangesCache.context) {
      Object.assign(allChanges, tabChangesCache.context)
    }

    // Agent Name validation - check for name duplication
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
  
  // Check if saving is possible (has changes and validation passed)
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

  // Tab switch handling - update URL route
  const handleTabSwitch = useCallback((tab: 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context') => {
    if (tabState.tabsEnabled[tab] && chatId) {
      const routeTab = tabToRouteMap[tab]
      navigate(`/agent/chat/${chatId}/settings/${routeTab}`)
    }
  }, [tabState.tabsEnabled, chatId, navigate])

  // Clear errors
  const handleClearError = useCallback(() => {
    setError(null)
  }, [])

  // Data save handling - strictly isolate data per Tab
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
      
      // Start from existing data, only update fields for current Tab
      const updateData: ChatAgent = { ...chat.agent }
      
      // Only update corresponding fields based on current Tab
      if (tabState.activeTab === 'basic') {
        if (data.name !== undefined) updateData.name = data.name // 🆕 Support ON-DEVICE agent renaming
        if (data.emoji !== undefined) updateData.emoji = data.emoji
        if (data.role !== undefined) updateData.role = data.role
        if (data.model !== undefined) updateData.model = data.model
      } else if (tabState.activeTab === 'knowledge') {
        if (data.knowledgeBase !== undefined) updateData.knowledgeBase = data.knowledgeBase
      } else if (tabState.activeTab === 'mcp') {
        if (data.mcpServers !== undefined) {
          updateData.mcp_servers = data.mcpServers
        }
      } else if (tabState.activeTab === 'skills') {
        if (data.skills !== undefined) {
          updateData.skills = data.skills
        }
      } else if (tabState.activeTab === 'prompt') {
        if (data.systemPrompt !== undefined) {
          updateData.system_prompt = data.systemPrompt
        }
      } else if (tabState.activeTab === 'context') {
        if (data.contextEnhancement !== undefined) {
          updateData.context_enhancement = data.contextEnhancement
        }
      }
      
      const result = await updateChat(chatId, {
        agent: updateData
      })
      
      if (result.success) {
        const currentAgentData = agentData || {
          id: chatId,
          name: chat.agent.name,
          emoji: chat.agent.emoji,
          role: chat.agent.role,
          model: chat.agent.model,
          workspace: chat.agent.workspace,
          knowledgeBase: chat.agent.knowledgeBase,
          version: chat.agent.version,
          mcpServers: chat.agent.mcp_servers,
          systemPrompt: chat.agent.system_prompt,
          contextEnhancement: chat.agent.context_enhancement,
          skills: chat.agent.skills,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        
        const updatedAgent: AgentConfig = { ...currentAgentData }
        
        if (tabState.activeTab === 'mcp') {
          updatedAgent.mcpServers = data.mcpServers !== undefined ? data.mcpServers : currentAgentData.mcpServers
        } else if (tabState.activeTab === 'skills') {
          updatedAgent.skills = data.skills !== undefined ? data.skills : currentAgentData.skills
        } else if (tabState.activeTab === 'prompt') {
          updatedAgent.systemPrompt = data.systemPrompt !== undefined ? data.systemPrompt : currentAgentData.systemPrompt
        } else if (tabState.activeTab === 'context') {
          updatedAgent.contextEnhancement = data.contextEnhancement !== undefined ? data.contextEnhancement : currentAgentData.contextEnhancement
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

  // Unified function to save all changes
  const handleSaveAll = useCallback(async () => {
    if (!canSaveAll) return

    setIsLoading(true)
    setError(null)

    try {
      // Collect all data pending save
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
      if (pendingChanges.prompt && tabChangesCache.prompt) {
        Object.assign(allChanges, tabChangesCache.prompt)
      }
      if (pendingChanges.context && tabChangesCache.context) {
        Object.assign(allChanges, tabChangesCache.context)
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
      
      // Update all modified fields
      if (allChanges.name !== undefined) updateData.name = allChanges.name // 🆕 Support ON-DEVICE agent renaming
      if (allChanges.emoji !== undefined) updateData.emoji = allChanges.emoji
      if (allChanges.role !== undefined) updateData.role = allChanges.role
      if (allChanges.model !== undefined) updateData.model = allChanges.model
      if (allChanges.knowledgeBase !== undefined) updateData.knowledgeBase = allChanges.knowledgeBase
      if (allChanges.mcpServers !== undefined) updateData.mcp_servers = allChanges.mcpServers
      if (allChanges.skills !== undefined) updateData.skills = allChanges.skills
      if (allChanges.systemPrompt !== undefined) updateData.system_prompt = allChanges.systemPrompt
      if (allChanges.contextEnhancement !== undefined) updateData.context_enhancement = allChanges.contextEnhancement
      
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
          knowledgeBase: updateData.knowledgeBase,
          version: updateData.version,
          mcpServers: updateData.mcp_servers,
          systemPrompt: updateData.system_prompt,
          contextEnhancement: updateData.context_enhancement,
          skills: updateData.skills,
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
        prompt: false,
        context: false
      })
      setTabChangesCache({
        basic: null,
        knowledge: null,
        mcp: null,
        skills: null,
        prompt: null,
        context: null
      })

      // Force re-mount all Tab components
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
    if (chatId) {
      navigate(`/agent/chat/${chatId}`)
    } else {
      navigate('/agent/chat')
    }
  }, [chatId, navigate])

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
          {/* Save button - show warning red when there are unsaved changes */}
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
          <div
            className={`nav-tab ${tabState.activeTab === 'knowledge' ? 'active' : ''} ${tabState.tabsEnabled.knowledge ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('knowledge')}
          >
            Knowledge
            {pendingChanges.knowledge && <span className="change-indicator">●</span>}
          </div>
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
            className={`nav-tab ${tabState.activeTab === 'prompt' ? 'active' : ''} ${tabState.tabsEnabled.prompt ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('prompt')}
          >
            System Prompt
            {pendingChanges.prompt && <span className="change-indicator">●</span>}
          </div>
          {/* Context Enhancement tab only shown in Dev environment */}
          {memoryEnabled && (
            <div
              className={`nav-tab ${tabState.activeTab === 'context' ? 'active' : ''} ${tabState.tabsEnabled.context ? '' : 'disabled'}`}
              onClick={() => handleTabSwitch('context')}
            >
              Context Enhancement
              {pendingChanges.context && <span className="change-indicator">●</span>}
            </div>
          )}
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

          {/* Only render the corresponding Tab content based on selection state */}
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
          
          {tabState.activeTab === 'context' && tabState.tabsEnabled.context && (
            <AgentContextEnhanceTab
              key={`context-${tabResetKey}`}
              mode="update"
              agentId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.context}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.context}
            />
          )}
        </div>
      </div>

    </div>
  )
}

export default AgentChatEditingView
