export interface AgentContextType {
  // MCP Server operation handlers
  onMcpServerConnect?: (serverName: string) => void;
  onMcpServerDisconnect?: (serverName: string) => void;
  onMcpServerReconnect?: (serverName: string) => void;
  onMcpServerDelete?: (serverName: string) => void;
  onMcpServerEdit?: (serverName: string) => void;

  // Menu Handlers
  onMcpServerMenuToggle?: (serverName: string, buttonElement: HTMLElement) => void;
  mcpServerMenuState?: {
    isOpen: boolean;
    serverName: string | null;
    position: { top: number; left: number } | null;
  };
  onMcpAddMenuToggle?: (buttonElement: HTMLElement) => void;
  onSkillsAddMenuToggle?: (buttonElement: HTMLElement) => void;
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void;

  // Sub-Agent Menu Handlers
  onSubAgentMenuToggle?: (subAgentName: string, buttonElement: HTMLElement) => void;
  onSubAgentsAddMenuToggle?: (buttonElement: HTMLElement) => void;
  subAgentMenuState?: {
    isOpen: boolean;
    subAgentName: string | null;
    position: { top: number; left: number } | null;
  };
}
