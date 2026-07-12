// Agent Chat Editor type definitions

import type { AgentSystemPrompt } from '@shared/types/agentSystemPrompt';

// Agent MCP Server config - contains server name and selected tools
export interface AgentMcpServer {
  name: string;
  tools: string[]; // Empty array means use all tools; otherwise only use specified tools
}

export interface AgentConfig {
  id: string
  name: string
  emoji: string
  avatar?: string
  role: string
  model: string
  workspace?: string // Chat working directory path
  knowledgeBase?: string // Knowledge Base directory path, defaults to workspace/knowledge
  version?: string // Agent version number
  source?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL'
  mcpServers: AgentMcpServer[] // MCP server config array
  systemPrompt: AgentSystemPrompt
  skills?: string[] // List of Skill names used by this Agent
  hooks?: string[] // List of Hook ids bound to this Agent
  authToken?: string // Auth token for external agent WS authentication
  createdAt: Date
  updatedAt: Date
}

export type AgentEditorTabName = 'basic' | 'knowledge' | 'mcp' | 'skills' | 'hooks' | 'schedules' | 'prompt'

export interface TabComponentProps {
  mode: 'add' | 'update'
  chatId?: string
  agentData?: AgentConfig
  onSave: (data: Partial<AgentConfig>) => Promise<AgentConfig> // Returns the fully updated AgentConfig
  onAgentCreated?: (agentId: string) => void // Callback after Basic Tab creation succeeds in Add mode
  onDataChange?: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void // Change tracking callback
  cachedData?: Partial<AgentConfig> | null // Cached modified data, used to preserve changes when switching tabs
  fieldErrors?: Record<string, string> // Field-level error messages
  readOnly?: boolean
}

export interface TabState {
  activeTab: AgentEditorTabName
  tabsEnabled: {
    basic: boolean
    knowledge: boolean
    mcp: boolean
    skills: boolean
    hooks: boolean
    schedules: boolean
    prompt: boolean
  }
  agentCreated: boolean // Flag indicating whether the agent has been created in Add mode
}

export interface EmojiPickerProps {
  isOpen: boolean
  onClose: () => void
  onEmojiSelect: (emoji: string) => void
  currentEmoji?: string
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  showPreview: boolean
  onTogglePreview: () => void
  readOnly?: boolean // Read-only mode, prevents editing content
  emptyTips?: readonly string[] // Guidance shown when the editor is empty
}