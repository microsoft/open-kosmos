import { Message, Config as ChatConfig } from './chatTypes';
import { WorkspaceMenuActions } from '../components/chat/workspace/WorkspaceExplorerSidepane';

export interface AgentContextType {
  // Chat data
  messages: Message[];
  allMessages: Message[];
  streamingMessageId?: string;
  onSendMessage: (message: Message) => void;
  onCancelChat?: () => void;
  onApprovalResponse?: (approved: boolean) => void;
  pendingApprovalRequest?: {
    requestId: string;
    toolName: string;
    path: string;
  } | null;

  // Config
  config: ChatConfig;
  onSaveConfig: (config: ChatConfig) => void;

  // Agent navigation handlers
  onNewAgent?: () => void;
  onEditAgent?: (chatId: string) => void;
  onDeleteAgent?: (chatId: string) => void;

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
  onWorkspaceMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  workspaceMenuState?: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    actions: WorkspaceMenuActions | null;
  };
  onMcpAddMenuToggle?: (buttonElement: HTMLElement) => void;
  onSkillsAddMenuToggle?: (buttonElement: HTMLElement) => void;
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void;
  onEditAgentMenuToggle?: (buttonElement: HTMLElement) => void;
  onAttachMenuToggle?: (buttonElement: HTMLElement) => void;
  onFileTreeNodeMenuToggle?: (event: React.MouseEvent, node: any, workspacePath: string) => void;

  // Layout props (legacy support for now)
  sidepaneWidth?: number;
  setSidepaneWidth?: (width: number) => void;
  isDragging?: boolean;
}
