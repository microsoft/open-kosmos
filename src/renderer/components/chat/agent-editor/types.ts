// Agent Chat Editor type definitions

// Agent MCP Server config - contains server name and selected tools
export interface AgentMcpServer {
  name: string;
  tools: string[]; // Empty array means use all tools; otherwise only use specified tools
}

export interface AgentConfig {
  id: string
  name: string
  emoji: string
  avatar?: string // Agent avatar URL
  role: string
  model: string
  workspace?: string // Agent working directory path
  knowledgeBase?: string // Knowledge Base directory path, defaults to workspace/knowledge
  version?: string // Agent version number
  source?: 'ON-DEVICE' | 'EXTERNAL' // Agent source
  mcpServers: AgentMcpServer[] // MCP server config array
  systemPrompt: string
  skills?: string[] // List of Skill names used by this Agent
  enabledPlugins?: string[] // Plugin IDs enabled for this Agent
  subAgents?: string[] // List of Sub-Agent names used by this Agent
  authToken?: string // Auth token for external agent WS authentication
  createdAt: Date
  updatedAt: Date
}

export type AgentEditorTabName = 'basic' | 'knowledge' | 'mcp' | 'skills' | 'plugins' | 'schedules' | 'sub_agents' | 'prompt'

export interface TabComponentProps {
  mode: 'add' | 'update'
  agentId?: string
  agentData?: AgentConfig
  onSave: (data: Partial<AgentConfig>) => Promise<AgentConfig> // Returns the fully updated AgentConfig
  onAgentCreated?: (agentId: string) => void // Callback after Basic Tab creation succeeds in Add mode
  onDataChange?: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void // Change tracking callback
  cachedData?: Partial<AgentConfig> | null // Cached modified data, used to preserve changes when switching tabs
  fieldErrors?: Record<string, string> // Field-level error messages
  readOnly?: boolean // Read-only mode, prevents editing for certain agents
}

export interface TabState {
  activeTab: AgentEditorTabName
  tabsEnabled: {
    basic: boolean
    knowledge: boolean
    mcp: boolean
    skills: boolean
    plugins: boolean
    schedules: boolean
    sub_agents: boolean
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
}
