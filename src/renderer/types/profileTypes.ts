// Base LLM API Settings for custom configuration
export interface LLMApiCustomSettings {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
  deploymentName: string;
}

// Preset model definition
export interface PresetModel {
  id: string;
  name: string;
  deploymentName: string;
  endpoint: string;
  apiKey: string;
  apiVersion: string;
}

// New unified LLM API Settings structure
export interface LLMApiSettings {
  type: 'custom' | 'preset';
  customSettings: LLMApiCustomSettings;
  modelName: string;
}


export interface MCPServer {
  name: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  in_use: boolean;
  url: string;
  command: string;
  args: string[];
  /** Environment variables required for server execution */
  env?: { [key: string]: string };
}

export interface UserProfile {
  alias: string;
  createdAt: string;
  updatedAt: string;
  llm_api_settings: LLMApiSettings;
  mcp_servers: MCPServer[];
}

export interface ProfileApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface LLMApiSettingsUpdate {
  type?: 'custom' | 'preset';
  customSettings?: Partial<LLMApiCustomSettings>;
  modelName?: string;
}

export interface MCPServerUpdate {
  name?: string;
  transport?: 'stdio' | 'sse' | 'StreamableHttp';
  in_use?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: { [key: string]: string };
}

export interface MCPServerCreate {
  name: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  in_use: boolean;
  url: string;
  command: string;
  args: string[];
  env?: { [key: string]: string };
}

// New GHC Profile Template Types
export interface GHCUser {
  id: string;
  login: string;
  email: string;
  name: string;
  avatarUrl: string;
  copilotPlan: string;
}

export interface GHCTokens {
  refresh: string;
  access: string;
  expires: number;
}

export interface GHCAuth {
  user: GHCUser;
  tokens: GHCTokens;
  capabilities: string[];
  selectedModel: string;
}

export interface MockAuthSection {
  alias: string;
  llm_api_settings: LLMApiSettings;
  modelName: string;
}

// New GHC Profile structure based on template
export interface GHCProfile {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: 'ghc' | 'mock';
  mockAuth: MockAuthSection;
  ghcAuth?: GHCAuth;
  mcp_servers: MCPServer[];
}

