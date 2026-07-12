import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { ChatAgent } from '../../../lib/userData/types'
import {
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  type AgentSystemPromptFile,
} from '@shared/types/agentSystemPrompt'
import { useFeatureFlag } from '../../../lib/featureFlags'
import { createLogger } from '../../../lib/utilities/logger'
import { useChats } from '../../userData/userDataProvider'
import { useToast } from '../../ui/ToastProvider'
import { useAgent, chatAgentId } from '../../../lib/agent'
import { useI18n } from '../../../lib/i18n/useI18n'
import type { AgentConfig, AgentEditorTabName, TabState } from '../agent-editor/types'
import {
  AGENT_EDITOR_TAB_TO_ROUTE_MAP,
  getAgentEditorTabFromRoute,
  shouldRedirectAgentEditorRouteToBasic,
} from './agentChatEditingRoutes'
import {
  AgentEditorPendingChanges,
  AgentEditorTabChangesCache,
  buildAgentConfig,
  buildUpdatedAgentConfig,
  collectPendingChanges,
  createAgentUpdateForAllChanges,
  createAgentUpdateForTab,
  createEmptyPendingChanges,
  createEmptyTabChangesCache,
  mergeActiveTabIntoAgentConfig,
  validateAgentName,
} from './agentChatEditingViewModel'

const logger = createLogger('[AgentChatEditingView]')

export interface AgentChatEditingViewModel {
  chatId?: string
  agentData?: AgentConfig
  error: string | null
  isLoading: boolean
  fieldErrors: Record<string, string>
  tabResetKey: number
  tabState: TabState
  pendingChanges: AgentEditorPendingChanges
  tabChangesCache: AgentEditorTabChangesCache
  isKnowledgeGroupExpanded: boolean
  isPromptGroupExpanded: boolean
  activePromptFile: AgentSystemPromptFile
  readOnlyFlags: Record<AgentEditorTabName, boolean>
  schedulerEnabled: boolean
  showKnowledgeSourcesGroup: boolean
  canSaveAll: boolean
  handleTabSwitch: (tab: AgentEditorTabName) => void
  handleKnowledgeGroupToggle: () => void
  handlePromptGroupToggle: () => void
  handlePromptFileSwitch: (file: AgentSystemPromptFile) => void
  handleClearError: () => void
  handleSave: (data: Partial<AgentConfig>) => Promise<AgentConfig>
  handleSaveAll: () => Promise<void>
  handleBackToChat: () => void
  handleTabDataChange: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void
  navigateToChatList: () => void
}

export function useAgentChatEditingViewModel(): AgentChatEditingViewModel {
  const { chatId, '*': tabParam } = useParams<{ chatId: string; '*': string }>()
  const navigate = useNavigate()
  const { chats, updateChat, updateChatAgent } = useChats()
  const { showSuccess } = useToast()
  const { t } = useI18n()
  const tRef = useRef(t)
  const schedulerEnabled = useFeatureFlag('openkosmosFeatureScheduler')
  const showKnowledgeSourcesGroup = schedulerEnabled
  const currentRouteTab = getAgentEditorTabFromRoute(tabParam)

  // Resolve the edited agent through the normalized agent cache
  // (agentClientCacheManager) keyed by the chat's agent id, falling back to the
  // inline `chat.agent` facade while it still exists (pre-Phase 4). This is what
  // decouples the editor from the `performNotification` recompose glue: once the
  // facade is removed, the agent is still resolved from the store-backed cache by
  // `agent_ids`, so the editor keeps working without the inline injection.
  const currentChat = chatId ? chats.find(candidate => candidate.chat_id === chatId) : undefined
  const currentAgentId = chatAgentId(currentChat)
  const resolvedAgent = useAgent(currentAgentId, currentChat?.agent ?? null)

  const [tabState, setTabState] = useState<TabState>({
    activeTab: currentRouteTab,
    tabsEnabled: {
      basic: true,
      knowledge: true,
      mcp: true,
      skills: true,
      hooks: true,
      schedules: true,
      prompt: true,
    },
    agentCreated: true,
  })
  const [agentData, setAgentData] = useState<AgentConfig | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [tabResetKey, setTabResetKey] = useState(0)
  const [isKnowledgeGroupExpanded, setIsKnowledgeGroupExpanded] = useState(currentRouteTab === 'knowledge')
  const [isPromptGroupExpanded, setIsPromptGroupExpanded] = useState(currentRouteTab === 'prompt')
  const [activePromptFile, setActivePromptFile] = useState<AgentSystemPromptFile>(AGENT_SYSTEM_PROMPT_BASE_FILE)
  const [pendingChanges, setPendingChanges] = useState<AgentEditorPendingChanges>(createEmptyPendingChanges)
  const [tabChangesCache, setTabChangesCache] = useState<AgentEditorTabChangesCache>(createEmptyTabChangesCache)

  const readOnlyFlags: Record<AgentEditorTabName, boolean> = {
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    hooks: false,
    schedules: false,
    prompt: false,
  }

  useEffect(() => {
    if (tabState.activeTab !== currentRouteTab) {
      setTabState(prev => ({ ...prev, activeTab: currentRouteTab }))
    }
  }, [currentRouteTab, tabState.activeTab])

  useEffect(() => {
    setActivePromptFile(AGENT_SYSTEM_PROMPT_BASE_FILE)
  }, [chatId, currentAgentId])

  useEffect(() => {
    setIsKnowledgeGroupExpanded(tabState.activeTab === 'knowledge')
  }, [tabState.activeTab])

  useEffect(() => {
    setIsPromptGroupExpanded(tabState.activeTab === 'prompt')
  }, [tabState.activeTab])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    if (!chatId) return
    if (resolvedAgent) {
      setAgentData(buildAgentConfig(chatId, resolvedAgent, currentChat?.workspace))
    } else {
      logger.error('[AgentChatEditingView] Agent not found for chatId:', chatId)
      setError(tRef.current('agent.editor.agentNotFound'))
    }
  }, [chatId, resolvedAgent, currentChat?.workspace])

  const handleTabDataChange = useCallback((tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => {
    setPendingChanges(prev => (
      prev[tabName] === hasChanges ? prev : { ...prev, [tabName]: hasChanges }
    ))
    setTabChangesCache(prev => {
      if (!hasChanges && prev[tabName] === null) {
        return prev
      }
      return { ...prev, [tabName]: hasChanges ? data : null }
    })
  }, [])

  const validateAllChanges = useCallback(() => {
    const allChanges = collectPendingChanges(pendingChanges, tabChangesCache)
    const currentName = allChanges.name || agentData?.name
    return validateAgentName(chats, chatId, currentName)
  }, [pendingChanges, tabChangesCache, agentData, chatId, chats])

  const hasAnyPendingChanges = Object.values(pendingChanges).some(Boolean)
  const validationResult = validateAllChanges()
  const canSaveAll = hasAnyPendingChanges && validationResult.isValid

  useEffect(() => {
    const { isValid, errorMessage, showError: shouldShowError } = validationResult
    if (!isValid && shouldShowError && errorMessage) {
      if (fieldErrors.name !== errorMessage) setFieldErrors({ name: errorMessage })
      // Surface the name error on the Basic tab by redirecting through the router,
      // which is the single source of truth for the active tab (see the route-sync
      // effect above). Writing tabState.activeTab directly here would fight that
      // effect and infinite-loop whenever the route points at a non-basic tab.
      if (currentRouteTab !== 'basic') {
        navigate(`/agent/chat/${chatId}/settings/basic`, { replace: true })
      }
    } else if (fieldErrors.name) {
      setFieldErrors({})
    }
  }, [validationResult.isValid, validationResult.errorMessage, validationResult.showError, fieldErrors.name, currentRouteTab, chatId, navigate])

  const handleTabSwitch = useCallback((tab: AgentEditorTabName) => {
    if (tabState.tabsEnabled[tab] && chatId) {
      const routeTab = AGENT_EDITOR_TAB_TO_ROUTE_MAP[tab]
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

  const handlePromptGroupToggle = useCallback(() => {
    const nextExpanded = !isPromptGroupExpanded
    setIsPromptGroupExpanded(nextExpanded)
    if (nextExpanded) {
      setActivePromptFile(AGENT_SYSTEM_PROMPT_BASE_FILE)
      if (chatId && tabState.activeTab !== 'prompt') {
        navigate(`/agent/chat/${chatId}/settings/system_prompt`)
      }
    }
  }, [chatId, isPromptGroupExpanded, navigate, tabState.activeTab])

  const handlePromptFileSwitch = useCallback((file: AgentSystemPromptFile) => {
    setActivePromptFile(file)
    if (chatId && tabState.activeTab !== 'prompt') {
      navigate(`/agent/chat/${chatId}/settings/system_prompt`)
    }
  }, [chatId, navigate, tabState.activeTab])

  const handleClearError = useCallback(() => setError(null), [])

  const findCurrentChatAgent = useCallback((): { chatAgent: ChatAgent; chatId: string } => {
    if (!chatId) throw new Error('No chat ID found for update operation')
    if (!resolvedAgent) throw new Error('Agent not found')
    return { chatAgent: resolvedAgent, chatId }
  }, [chatId, resolvedAgent])

  const handleSave = useCallback(async (data: Partial<AgentConfig>): Promise<AgentConfig> => {
    setError(null)
    setIsLoading(true)
    try {
      const { chatAgent, chatId: activeChatId } = findCurrentChatAgent()
      const workspaceUpdate = data.workspace
      const updateData = createAgentUpdateForTab(chatAgent, tabState.activeTab, data)
      // Persist through the store-aware path so the edit lands in the standalone
      // agent store (agents/{id}/agent.json via syncChatAgentsToStore). Routing
      // through updateChatConfig would only merge an inline agent into
      // profile.json, which is stripped on write — leaving agent.json stale.
      const result = await updateChatAgent(activeChatId, updateData)
      if (!result.success) throw new Error(result.error || 'Failed to update agent')
      if (workspaceUpdate !== undefined) {
        const workspaceResult = await updateChat(activeChatId, { workspace: workspaceUpdate })
        if (!workspaceResult.success) throw new Error(workspaceResult.error || 'Failed to update chat workspace')
      }
      const updatedAgent = mergeActiveTabIntoAgentConfig(agentData, activeChatId, chatAgent, tabState.activeTab, data)
      setAgentData(updatedAgent)
      return updatedAgent
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : t('agent.editor.unknownSaveError')
      setError(t('agent.editor.saveFailed', { error: errorMessage }))
      throw saveError
    } finally {
      setIsLoading(false)
    }
  }, [agentData, findCurrentChatAgent, tabState.activeTab, updateChat, updateChatAgent, t])

  const handleSaveAll = useCallback(async () => {
    if (!canSaveAll) return
    setIsLoading(true)
    setError(null)
    try {
      const allChanges = collectPendingChanges(pendingChanges, tabChangesCache)
      const { chatAgent, chatId: activeChatId } = findCurrentChatAgent()
      const workspaceUpdate = allChanges.workspace
      const updateData = createAgentUpdateForAllChanges(chatAgent, allChanges)
      // Store-aware persistence (agents/{id}/agent.json), same rationale as handleSave.
      const result = await updateChatAgent(activeChatId, updateData)
      if (!result.success) throw new Error(result.error || 'Failed to update agent')
      if (workspaceUpdate !== undefined) {
        const workspaceResult = await updateChat(activeChatId, { workspace: workspaceUpdate })
        if (!workspaceResult.success) throw new Error(workspaceResult.error || 'Failed to update chat workspace')
      }

      setAgentData(buildUpdatedAgentConfig(activeChatId, updateData, workspaceUpdate ?? currentChat?.workspace, agentData?.createdAt))
      setPendingChanges(createEmptyPendingChanges())
      setTabChangesCache(createEmptyTabChangesCache())
      setTabResetKey(prev => prev + 1)
      showSuccess(t('agent.editor.allChangesSaved'))
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : t('agent.editor.unknownSaveError')
      setError(t('agent.editor.saveFailed', { error: errorMessage }))
    } finally {
      setIsLoading(false)
    }
  }, [canSaveAll, pendingChanges, tabChangesCache, findCurrentChatAgent, updateChat, updateChatAgent, currentChat?.workspace, agentData?.createdAt, showSuccess, t])

  const handleBackToChat = useCallback(() => {
    if (!chatId) {
      navigate('/agent/chat')
      return
    }
    const targetChat = chats.find(chat => chat.chat_id === chatId)
    const hasExistingSessions = Boolean(targetChat?.chatSessions?.length)
    if (!hasExistingSessions) {
      navigate(`/agent/chat/${chatId}`, { state: { intent: 'new-chat', source: 'agent-settings-back' } })
      return
    }
    navigate(`/agent/chat/${chatId}`)
  }, [chatId, chats, navigate])

  useEffect(() => {
    if (!chatId) return
    if (shouldRedirectAgentEditorRouteToBasic(tabParam)) {
      navigate(`/agent/chat/${chatId}/settings/basic`, { replace: true })
    }
  }, [chatId, tabParam, navigate])

  return {
    chatId,
    agentData,
    error,
    isLoading,
    fieldErrors,
    tabResetKey,
    tabState,
    pendingChanges,
    tabChangesCache,
    isKnowledgeGroupExpanded,
    isPromptGroupExpanded,
    activePromptFile,
    readOnlyFlags,
    schedulerEnabled,
    showKnowledgeSourcesGroup,
    canSaveAll,
    handleTabSwitch,
    handleKnowledgeGroupToggle,
    handlePromptGroupToggle,
    handlePromptFileSwitch,
    handleClearError,
    handleSave,
    handleSaveAll,
    handleBackToChat,
    handleTabDataChange,
    navigateToChatList: () => navigate('/agent/chat'),
  }
}
