import type { ChatAgent, ChatConfig } from '../../../lib/userData/types'
import type { AgentConfig, AgentEditorTabName } from '../agent-editor/types'
import { resolveChatAgent } from '@/lib/agent'
import { normalizeAgentSystemPrompt } from '@shared/types/agentSystemPrompt'

export type AgentEditorPendingChanges = Record<AgentEditorTabName, boolean>
export type AgentEditorTabChangesCache = Record<AgentEditorTabName, Partial<AgentConfig> | null>

export const AGENT_EDITOR_TAB_NAMES: AgentEditorTabName[] = [
  'basic',
  'knowledge',
  'mcp',
  'skills',
  'hooks',
  'schedules',
  'prompt',
]

export function createEmptyPendingChanges(): AgentEditorPendingChanges {
  return {
    basic: false,
    knowledge: false,
    mcp: false,
    skills: false,
    hooks: false,
    schedules: false,
    prompt: false,
  }
}

export function createEmptyTabChangesCache(): AgentEditorTabChangesCache {
  return {
    basic: null,
    knowledge: null,
    mcp: null,
    skills: null,
    hooks: null,
    schedules: null,
    prompt: null,
  }
}

export const getAgentKnowledge = (agent?: ChatAgent | null) => ({
  knowledgeBase: agent?.knowledge?.knowledgeBase ?? agent?.knowledgeBase,
})

export function buildAgentConfig(chatId: string, agent: ChatAgent, chatWorkspace?: string): AgentConfig {
  const knowledge = getAgentKnowledge(agent)
  return {
    id: chatId,
    name: agent.name,
    emoji: agent.emoji,
    avatar: agent.avatar,
    role: agent.role,
    model: agent.model,
    workspace: chatWorkspace ?? agent.workspace,
    knowledgeBase: knowledge.knowledgeBase,
    version: agent.version,
    source: agent.source,
    mcpServers: agent.mcp_servers,
    systemPrompt: normalizeAgentSystemPrompt(agent.system_prompt),
    skills: agent.skills,
    hooks: agent.hooks,
    authToken: agent.authToken,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function collectPendingChanges(
  pendingChanges: AgentEditorPendingChanges,
  tabChangesCache: AgentEditorTabChangesCache,
): Partial<AgentConfig> {
  const allChanges: Partial<AgentConfig> = {}
  for (const tabName of AGENT_EDITOR_TAB_NAMES) {
    if (pendingChanges[tabName] && tabChangesCache[tabName]) {
      Object.assign(allChanges, tabChangesCache[tabName])
    }
  }
  return allChanges
}

export function validateAgentName(
  chats: ChatConfig[],
  currentChatId: string | undefined,
  currentName: string | undefined,
) {
  const trimmedName = currentName?.trim()
  if (!trimmedName) {
    return { isValid: true, errorMessage: null, showError: false }
  }

  const existingAgent = chats.find(chat => {
    const agent = resolveChatAgent(chat)
    return agent?.name === trimmedName && chat.chat_id !== currentChatId
  })

  if (existingAgent) {
    return {
      isValid: false,
      errorMessage: `Agent name "${trimmedName}" already exists. Please choose a different name.`,
      showError: true,
    }
  }

  return { isValid: true, errorMessage: null, showError: false }
}

function cloneAgentForUpdate(agent: ChatAgent): ChatAgent {
  return {
    ...agent,
    knowledge: {
      knowledgeBase: agent.knowledge?.knowledgeBase ?? agent.knowledgeBase ?? '',
    },
  }
}

export function createAgentUpdateForTab(
  agent: ChatAgent,
  activeTab: AgentEditorTabName,
  data: Partial<AgentConfig>,
): ChatAgent {
  const updateData = cloneAgentForUpdate(agent)

  if (activeTab === 'basic') {
    if (data.name !== undefined) updateData.name = data.name
    if (data.emoji !== undefined) updateData.emoji = data.emoji
    if (data.role !== undefined) updateData.role = data.role
    if (data.model !== undefined) updateData.model = data.model
  } else if (activeTab === 'knowledge') {
    if (data.knowledgeBase !== undefined) updateData.knowledge!.knowledgeBase = data.knowledgeBase
  } else if (activeTab === 'mcp') {
    if (data.mcpServers !== undefined) updateData.mcp_servers = data.mcpServers
  } else if (activeTab === 'skills') {
    if (data.skills !== undefined) updateData.skills = data.skills
  } else if (activeTab === 'hooks') {
    if (data.hooks !== undefined) updateData.hooks = data.hooks
  } else if (activeTab === 'prompt') {
    if (data.systemPrompt !== undefined) updateData.system_prompt = normalizeAgentSystemPrompt(data.systemPrompt)
  }

  delete updateData.workspace
  return updateData
}

export function createAgentUpdateForAllChanges(
  agent: ChatAgent,
  allChanges: Partial<AgentConfig>,
): ChatAgent {
  const updateData = cloneAgentForUpdate(agent)

  if (allChanges.name !== undefined) updateData.name = allChanges.name
  if (allChanges.emoji !== undefined) updateData.emoji = allChanges.emoji
  if (allChanges.role !== undefined) updateData.role = allChanges.role
  if (allChanges.model !== undefined) updateData.model = allChanges.model
  if (allChanges.knowledgeBase !== undefined) updateData.knowledge!.knowledgeBase = allChanges.knowledgeBase
  if (allChanges.mcpServers !== undefined) updateData.mcp_servers = allChanges.mcpServers
  if (allChanges.skills !== undefined) updateData.skills = allChanges.skills
  if (allChanges.hooks !== undefined) updateData.hooks = allChanges.hooks
  if (allChanges.systemPrompt !== undefined) updateData.system_prompt = normalizeAgentSystemPrompt(allChanges.systemPrompt)
  delete updateData.workspace

  return updateData
}

export function mergeActiveTabIntoAgentConfig(
  currentAgentData: AgentConfig | undefined,
  chatId: string,
  sourceAgent: ChatAgent,
  activeTab: AgentEditorTabName,
  data: Partial<AgentConfig>,
): AgentConfig {
  const updatedAgent: AgentConfig = {
    ...(currentAgentData || buildAgentConfig(chatId, sourceAgent)),
  }

  if (activeTab === 'mcp') {
    updatedAgent.mcpServers = data.mcpServers !== undefined ? data.mcpServers : updatedAgent.mcpServers
  } else if (activeTab === 'skills') {
    updatedAgent.skills = data.skills !== undefined ? data.skills : updatedAgent.skills
  } else if (activeTab === 'hooks') {
    updatedAgent.hooks = data.hooks !== undefined ? data.hooks : updatedAgent.hooks
  } else if (activeTab === 'prompt') {
    updatedAgent.systemPrompt = data.systemPrompt !== undefined ? normalizeAgentSystemPrompt(data.systemPrompt) : updatedAgent.systemPrompt
  } else if (activeTab === 'knowledge') {
    if (data.knowledgeBase !== undefined) updatedAgent.knowledgeBase = data.knowledgeBase
    if (data.workspace !== undefined) updatedAgent.workspace = data.workspace
  } else if (activeTab === 'basic') {
    if (data.name !== undefined) updatedAgent.name = data.name
    if (data.emoji !== undefined) updatedAgent.emoji = data.emoji
    if (data.role !== undefined) updatedAgent.role = data.role
    if (data.model !== undefined) updatedAgent.model = data.model
  }

  updatedAgent.updatedAt = new Date()
  return updatedAgent
}

export function buildUpdatedAgentConfig(
  chatId: string,
  updateData: ChatAgent,
  chatWorkspace?: string,
  createdAt?: Date,
): AgentConfig {
  const knowledge = getAgentKnowledge(updateData)
  return {
    id: chatId,
    name: updateData.name,
    emoji: updateData.emoji,
    role: updateData.role,
    model: updateData.model,
    workspace: chatWorkspace ?? updateData.workspace,
    knowledgeBase: knowledge.knowledgeBase,
    version: updateData.version,
    source: updateData.source,
    mcpServers: updateData.mcp_servers,
    systemPrompt: normalizeAgentSystemPrompt(updateData.system_prompt),
    skills: updateData.skills,
    hooks: updateData.hooks,
    authToken: updateData.authToken,
    createdAt: createdAt || new Date(),
    updatedAt: new Date(),
  }
}
