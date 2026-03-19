// Agent Chat Editor type definitions

// Agent MCP Server configuration - contains server name and selected tools
export interface AgentMcpServer {
  name: string;
  tools: string[]; // Empty array means use all tools, otherwise only use specified tools
}

// Context Enhancement configuration - corresponds to ContextEnhancement type in ProfileDataManager
export interface AgentContextEnhancement {
  search_memory: {
    enabled: boolean;
    semantic_similarity_threshold: number;
    semantic_top_n: number;
  };
  generate_memory: {
    enabled: boolean;
  };
}

export interface AgentConfig {
  id: string
  name: string
  emoji: string
  avatar?: string // Agent avatar URL
  role: string
  model: string
  workspace?: string // Agent workspace directory path
  knowledgeBase?: string // Knowledge Base directory path, defaults to workspace/knowledge
  version?: string // Agent version number
  mcpServers: AgentMcpServer[] // MCP server configuration array
  systemPrompt: string
  contextEnhancement?: AgentContextEnhancement // Context Enhancement configuration
  skills?: string[] // List of Skill names used by the Agent
  createdAt: Date
  updatedAt: Date
}

export interface TabComponentProps {
  mode: 'add' | 'update'
  agentId?: string
  agentData?: AgentConfig
  onSave: (data: Partial<AgentConfig>) => Promise<AgentConfig> // Returns the updated complete AgentConfig
  onAgentCreated?: (agentId: string) => void // Callback after successful creation in Add mode Basic Tab
  onDataChange?: (tabName: 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context', data: Partial<AgentConfig>, hasChanges: boolean) => void // Change tracking callback
  cachedData?: Partial<AgentConfig> | null // Cached modification data for preserving changes when switching tabs
  fieldErrors?: Record<string, string> // Field-level error messages
  readOnly?: boolean // Read-only mode
  isFromLibrary?: boolean // For fine-grained edit permission control
}

export interface TabState {
  activeTab: 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context'
  tabsEnabled: {
    basic: boolean
    knowledge: boolean
    mcp: boolean
    skills: boolean
    prompt: boolean
    context: boolean
  }
  agentCreated: boolean // Flag indicating whether agent has been created in Add mode
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
  readOnly?: boolean // Read-only mode, editing disabled
}