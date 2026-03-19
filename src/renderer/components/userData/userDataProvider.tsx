import React, { createContext, useContext, useState, useEffect } from 'react'
import { useAuthContext } from '../auth/AuthProvider';
import { profileDataManager, ProfileCacheData } from '../../lib/userData'
import { ChatConfigRuntime, ChatAgent, AgentMcpServer, SkillConfig } from '../../lib/userData/types'
import { MCPServer } from '../../types/profileTypes'
import { GhcModel } from '../../types/ghcChatTypes'

import { chatOps, ChatOpsManager } from '../../lib/chat/chatOps'
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager'

// 🆕 Refactor: MCP types and state management obtained directly from mcpClientCacheManager
import {
  mcpClientCacheManager,
  MCPServerExtended,
  MCPTool,
  MCPStats
} from '../../lib/mcp/mcpClientCacheManager'

interface ProfileDataContextType {
  // Basic data
  data: ProfileCacheData
  isLoading: boolean
  isInitialized: boolean
  
  // Chat configuration management (replaces GHC model data) - uses Runtime types to support chatSessions
  chats: ChatConfigRuntime[]
  
  // Agent configuration management (replaces updateSelectedModel)
  currentAgent: ChatAgent | null
  currentModel: string | null
  assignedMcpServers: AgentMcpServer[]
  
  // Chat operations management (handled by chatOps.ts)
  chatOps: ChatOpsManager  // Provide ChatOps instance
  
  // MCP Servers management (unchanged)
  mcpServers: MCPServerExtended[]
  mcpStats: {
    totalServers: number
    connectedServers: number
    disconnectedServers: number
    errorServers: number
    totalTools: number
  }
  getAllMCPTools: () => MCPTool[]
  getMCPServerByName: (name: string) => MCPServerExtended | null
  addMCPServer: (server: MCPServer) => Promise<boolean>
  updateMCPServer: (serverName: string, updates: Partial<MCPServer>) => Promise<boolean>
  deleteMCPServer: (serverName: string) => Promise<boolean>
  
  // Control methods
  refresh: () => Promise<void>
  refreshMCPRuntimeInfo: () => Promise<void>
  isDataStale: (maxAgeMs?: number) => boolean
}

const ProfileDataContext = createContext<ProfileDataContextType | undefined>(undefined)

export function ProfileDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ProfileCacheData>(profileDataManager.getCache())
  const [isLoading, setIsLoading] = useState(false)
  
  // 🔧 Fix: add reactive state to track current Agent configuration
  const [currentAgent, setCurrentAgent] = useState<ChatAgent | null>(null)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [assignedMcpServers, setAssignedMcpServers] = useState<AgentMcpServer[]>([])
  
  // 🔥 New: track currentChatId to force agent update on chatId change
  const [trackedChatId, setTrackedChatId] = useState<string | null>(null)
  
  // 🆕 Refactor: MCP data obtained directly from mcpClientCacheManager
  const [mcpServers, setMcpServers] = useState<MCPServerExtended[]>(mcpClientCacheManager.getMCPServers())
  const [mcpStats, setMcpStats] = useState<MCPStats>(mcpClientCacheManager.getMCPStats())

  const { user } = useAuthContext()

  // Only support GitHub Copilot auth (login) - auth data no longer cached in profile
  const userAlias = user?.login

  // 🔥 New: listen for currentChatId changes and force agent update
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId()
      
      // When chatId changes, force update agent info
      if (newChatId !== trackedChatId) {
        setTrackedChatId(newChatId)
        
        const updatedAgent = profileDataManager.getCurrentAgent()
        const updatedModel = profileDataManager.getCurrentModel()
        const updatedMcpServers = profileDataManager.getAssignedMcpServers()
        
        setCurrentAgent(updatedAgent)
        setCurrentModel(updatedModel)
        setAssignedMcpServers(updatedMcpServers)
      }
    })
    return unsubscribe
  }, [trackedChatId])

  useEffect(() => {
    // Subscribe to data changes
    const unsubscribe = profileDataManager.subscribe((newData) => {
      
      // 🔧 FIX: check if chat session data has changed
      const hasChatsDataChanged = JSON.stringify(data.chats) !== JSON.stringify(newData.chats)
      const hasDataTimestampChanged = data.lastUpdated !== newData.lastUpdated
      
      
      // 🔧 CRITICAL FIX: always update data, especially when chat session data or timestamp changes
      setData(newData)
      
      // 🔧 FIXED: smart detection of actual config changes, avoid MCP tool updates triggering Agent rebuild
      const updatedAgent = profileDataManager.getCurrentAgent()
      const updatedModel = profileDataManager.getCurrentModel()
      const updatedMcpServers = profileDataManager.getAssignedMcpServers()
      
      // 🔥 Key fix: get current chatId to ensure comparing agent of the same chat
      const currentChatId = agentChatSessionCacheManager.getCurrentChatId()
      
      // Compare core configuration instead of object references, prevent MCP tool changes being misjudged as Agent changes
      // 🔥 Fix: only do detailed comparison when currentAgent exists and chatId hasn't changed
      const hasAgentConfigChanged = !currentAgent ||
        currentChatId !== trackedChatId || // 🔥 Key: force update when chatId changes
        currentAgent.role !== updatedAgent?.role ||
        currentAgent.name !== updatedAgent?.name ||
        currentAgent.emoji !== updatedAgent?.emoji ||
        currentAgent.system_prompt !== updatedAgent?.system_prompt ||
        currentAgent.version !== updatedAgent?.version ||
        JSON.stringify(currentAgent.skills) !== JSON.stringify(updatedAgent?.skills)
        
      const hasModelChanged = currentModel !== updatedModel
      const hasMcpServersChanged = JSON.stringify(assignedMcpServers) !== JSON.stringify(updatedMcpServers)
      
      // Only update Agent-related state on actual config changes, avoid unnecessary Agent rebuilds
      if (hasAgentConfigChanged) {
        setCurrentAgent(updatedAgent)
      }
      
      if (hasModelChanged) {
        setCurrentModel(updatedModel)
      }
      
      if (hasMcpServersChanged) {
        setAssignedMcpServers(updatedMcpServers)
      }
      
      if (!hasAgentConfigChanged && !hasModelChanged && !hasMcpServersChanged) {
        if (hasChatsDataChanged || hasDataTimestampChanged) {
        } else {
        }
      }
      
    })

    // Initialize data if not already initialized and user is authenticated
    // Note: Auth data is no longer cached in profile, only model/MCP configs
    if (!data.isInitialized && userAlias) {
      setIsLoading(true)
      
      const initializeAll = async () => {
        try {
          // Initialize ProfileDataManager first with correct user alias
          await profileDataManager.initialize(userAlias)
          
          // 🔧 Fix: sync Agent state immediately after initialization
          const initialAgent = profileDataManager.getCurrentAgent()
          const initialModel = profileDataManager.getCurrentModel()
          const initialMcpServers = profileDataManager.getAssignedMcpServers()
          
          
          setCurrentAgent(initialAgent)
          setCurrentModel(initialModel)
          setAssignedMcpServers(initialMcpServers)
          
          // 🔥 Remove old logic: no longer auto-initialize new chat session for first chat (Kosmos)
          // In new logic, backend agentChatManager auto-initializes for Primary Agent
          // Here we only need to get initial Agent state for frontend display, no need to call startNewChatFor
          const allChats = profileDataManager.getChatConfigs()
          if (allChats && allChats.length > 0) {
            // Get current selected Agent state (based on backend's Primary Agent selection)
            const currentAgent = profileDataManager.getCurrentAgent()
            const currentModel = profileDataManager.getCurrentModel()
            const currentMcpServers = profileDataManager.getAssignedMcpServers()
            
            if (currentAgent) {
              setCurrentAgent(currentAgent)
              setCurrentModel(currentModel)
              setAssignedMcpServers(currentMcpServers)
            }
          }
          
          // Note: MCP client manager initialization is now handled automatically
          // when servers are accessed, no manual initialization required
        } catch (error) {
        } finally {
          setIsLoading(false)
        }
      }
      
      initializeAll()
    }

    return unsubscribe
  }, [data.isInitialized, userAlias])

  // V2: Initialize ChatOps with user alias
  useEffect(() => {
    if (userAlias) {
      chatOps.initialize(userAlias)
    }
    return () => {
      chatOps.cleanup()
    }
  }, [userAlias])

  // 🆕 Refactor: subscribe to mcpClientCacheManager state changes
  useEffect(() => {
    // Initialize mcpClientCacheManager
    mcpClientCacheManager.initialize().catch(err => {
      console.error('[ProfileDataProvider] Failed to initialize mcpClientCacheManager:', err)
    })

    // Subscribe to MCP state changes
    const unsubscribe = mcpClientCacheManager.subscribe((mcpData) => {
      console.log('[ProfileDataProvider] MCP state update received:', mcpData.servers.map(s => ({ name: s.name, status: s.status })))
      setMcpServers(mcpData.servers)
      setMcpStats(mcpClientCacheManager.getMCPStats())
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // MCP Server methods - use mcpClientManager which will notify ProfileDataManager
  const addMCPServer = async (server: MCPServer): Promise<boolean> => {
    setIsLoading(true)
    try {
      // Convert MCPServer to the format expected by mcpClientManager
      const mcpServerConfig = {
        name: server.name,
        transport: server.transport,
        command: server.command || '',
        args: server.args || [],
        env: server.env || {},
        url: server.url || '',
        in_use: server.in_use
      }
      
      // Use mcpClientManager which will handle profile updates and notify ProfileDataManager
      const response = await window.electronAPI.mcp.addServer(server.name, mcpServerConfig)
      
      if (response.success) {
      } else {
      }
      
      return response.success
    } catch (error) {
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const updateMCPServer = async (serverName: string, updates: Partial<MCPServer>): Promise<boolean> => {
    setIsLoading(true)
    try {
      // Convert updates to the format expected by mcpClientManager
      const mcpServerUpdates = {
        name: updates.name || serverName,
        transport: updates.transport,
        command: updates.command || '',
        args: updates.args || [],
        env: updates.env || {},
        url: updates.url || '',
        in_use: updates.in_use
      }
      
      // Use mcpClientManager which will handle profile updates and notify ProfileDataManager
      const response = await window.electronAPI.mcp.updateServer(serverName, mcpServerUpdates)
      
      if (response.success) {
      } else {
      }
      
      return response.success
    } catch (error) {
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const deleteMCPServer = async (serverName: string): Promise<boolean> => {
    setIsLoading(true)
    try {
      // Use mcpClientManager which will handle profile updates and notify ProfileDataManager
      const response = await window.electronAPI.mcp.deleteServer(serverName)
      
      if (response.success) {
      } else {
      }
      
      return response.success
    } catch (error) {
      return false
    } finally {
      setIsLoading(false)
    }
  }

  // Control methods
  const refresh = async (): Promise<void> => {
    if (!userAlias) {
      return
    }

    setIsLoading(true)
    try {
      await profileDataManager.refresh()
    } finally {
      setIsLoading(false)
    }
  }

  const refreshMCPRuntimeInfo = async (): Promise<void> => {
    setIsLoading(true)
    try {
      
      // Instead of doing a full refresh which clears everything, just request fresh runtime states
      // The ProfileDataManager will get notified via IPC when mcpClientManager updates states
      const response = await window.electronAPI.mcp.getServerStatus()
      
      if (response.success) {
        // The MCP runtime states will be pushed to ProfileDataManager via IPC notifications
        // No need to do anything else - the data will update automatically
      } else {
      }
    } catch (error) {
    } finally {
      setIsLoading(false)
    }
  }

  const value: ProfileDataContextType = {
    // Basic data
    data,
    isLoading,
    isInitialized: data.isInitialized,
    
    // Chat configuration management (replaces GHC model data)
    chats: data.chats,
    
    // Agent configuration management (based on current Chat)
    // 🔧 Fix: use reactive state instead of static calls
    currentAgent,
    currentModel,
    assignedMcpServers,
    
    // Provide ChatOps instance for components to use
    chatOps: chatOps,
    
    // 🆕 Refactor: MCP data obtained directly from mcpClientCacheManager (via reactive state)
    mcpServers,
    mcpStats,
    getAllMCPTools: () => mcpClientCacheManager.getAllMCPTools(),
    getMCPServerByName: (name: string) => mcpClientCacheManager.getMCPServerByName(name),
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
    
    // Control methods
    refresh,
    refreshMCPRuntimeInfo,
    isDataStale: (maxAgeMs?: number) => profileDataManager.isDataStale(maxAgeMs)
  }

  return (
    <ProfileDataContext.Provider value={value}>
      {children}
    </ProfileDataContext.Provider>
  )
}

// Main hook to use profile data
export function useProfileData() {
  const context = useContext(ProfileDataContext)
  if (context === undefined) {
    throw new Error('useProfileData must be used within a ProfileDataProvider')
  }
  return context
}

// Specific hooks for different data types
export function useMCPServers() {
  const { 
    mcpServers, 
    mcpStats, 
    getAllMCPTools, 
    getMCPServerByName, 
    addMCPServer, 
    updateMCPServer, 
    deleteMCPServer,
    refreshMCPRuntimeInfo,
    isLoading 
  } = useProfileData()
  
  return {
    servers: mcpServers,
    stats: mcpStats,
    tools: getAllMCPTools(),
    getServerByName: getMCPServerByName,
    addServer: addMCPServer,
    updateServer: updateMCPServer,
    deleteServer: deleteMCPServer,
    refreshRuntimeInfo: refreshMCPRuntimeInfo,
    isLoading
  }
}

// Hook to check if profile data is ready
export function useProfileDataReady() {
  const { isInitialized, isLoading } = useProfileData()
  return { isReady: isInitialized && !isLoading, isLoading, isInitialized }
}

// ========== V2 Chat Management Hook ==========
export function useChats() {
  const {
    chats,
    chatOps,
    isLoading
  } = useProfileData()
  
  return {
    chats,
    addChat: (chatConfig: Partial<ChatConfigRuntime>) => chatOps.addChatConfig(chatConfig),
    updateChat: (chatId: string, updates: Partial<ChatConfigRuntime>) => chatOps.updateChatConfig(chatId, updates),
    deleteChat: (chatId: string) => chatOps.deleteChatConfig(chatId),
    isLoading
  }
}

// Agent configuration Hook (replaces useGHCModelData)
// ⚠️ Note: this hook returns Agent configuration based on profileDataManager.getCurrentChat()
// getCurrentChat() internally gets the current chatId via agentChatSessionCacheManager.getCurrentChatId()
export function useAgentConfig() {
  const {
    currentAgent,
    currentModel,
    assignedMcpServers,
    chatOps,
    isLoading
  } = useProfileData()
  
  // 🔥 Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  )
  
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId()
      setCurrentChatId(newChatId)
    })
    return unsubscribe
  }, [])
  
  return {
    agent: currentAgent,
    currentModel,
    assignedMcpServers,
    // Provide Agent configuration update convenience methods
    updateModel: async (model: string) => {
      if (!currentChatId) return { success: false, error: 'No current chat' };
      
      try {
        const result = await chatOps.updateChatAgent(currentChatId, { model });
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    updateMcpServers: async (mcp_servers: AgentMcpServer[]) => {
      if (!currentChatId) return { success: false, error: 'No current chat' };
      
      try {
        const result = await chatOps.updateChatAgent(currentChatId, { mcp_servers });
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    updateConfig: async (updates: Partial<ChatAgent>) => {
      if (!currentChatId) return { success: false, error: 'No current chat' };
      
      try {
        const result = await chatOps.updateChatAgent(currentChatId, updates);
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    isLoading
  }
}


// Hook for manual data refresh
export function useProfileDataRefresh() {
  const { refresh, refreshMCPRuntimeInfo, isLoading, isDataStale } = useProfileData()
  return {
    refresh,
    refreshMCPRuntimeInfo,
    isLoading,
    isDataStale
  }
}

// ========== Skills Management Hook ==========
export function useSkills() {
  const { data, isLoading } = useProfileData()
  
  return {
    skills: data.skills || [],
    stats: profileDataManager.getSkillsStats(),
    getSkillByName: (name: string) => profileDataManager.getSkillByName(name),
    getCurrentAgentSkills: () => profileDataManager.getCurrentAgentSkills(),
    isLoading
  }
}