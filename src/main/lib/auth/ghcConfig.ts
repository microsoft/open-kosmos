// src/main/lib/auth/ghcConfig.ts
export const GHC_CONFIG = {
  // Authentication configuration
  CLIENT_ID: process.env.GHC_CLIENT_ID || 'Iv1.b507a08c87ecfe98',
  CLIENT_SECRET: undefined,
  
  // API endpoint configuration
  API_ENDPOINT: 'https://api.githubcopilot.com',
  DEVICE_CODE_URL: 'https://github.com/login/device/code',
  ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  COPILOT_TOKEN_URL: 'https://api.github.com/copilot_internal/v2/token',
  
  // User agent configuration (GitHub standard)
  USER_AGENT: 'GitHubCopilotChat/0.26.7',
  EDITOR_VERSION: 'vscode/1.99.3',
  EDITOR_PLUGIN_VERSION: 'copilot-chat/0.26.7',
  INTEGRATION_ID: 'vscode-chat',
  
  // Standard Headers configuration (consistent with GitHub Copilot VSCode extension)
  STANDARD_HEADERS: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'GitHubCopilotChat/0.26.7',
    'Editor-Version': 'vscode/1.99.3',
    'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    'Copilot-Integration-Id': 'vscode-chat',
    'X-Request-Id': () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
};

// Configuration validation function
export function validateGhcConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!GHC_CONFIG.CLIENT_ID) {
    errors.push('GitHub Copilot Client ID is required');
  }
  
  if (!GHC_CONFIG.API_ENDPOINT) {
    errors.push('GitHub Copilot API endpoint is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Headers utility function
export function getStandardHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': GHC_CONFIG.STANDARD_HEADERS.Accept,
    'Content-Type': GHC_CONFIG.STANDARD_HEADERS['Content-Type'],
    'User-Agent': GHC_CONFIG.STANDARD_HEADERS['User-Agent'],
    'Editor-Version': GHC_CONFIG.STANDARD_HEADERS['Editor-Version'],
    'Editor-Plugin-Version': GHC_CONFIG.STANDARD_HEADERS['Editor-Plugin-Version'],
    'Copilot-Integration-Id': GHC_CONFIG.STANDARD_HEADERS['Copilot-Integration-Id'],
    'X-Request-Id': typeof GHC_CONFIG.STANDARD_HEADERS['X-Request-Id'] === 'function'
      ? (GHC_CONFIG.STANDARD_HEADERS['X-Request-Id'] as () => string)()
      : GHC_CONFIG.STANDARD_HEADERS['X-Request-Id']
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  return headers;
}

export function getCopilotTokenHeaders(githubAccessToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${githubAccessToken}`,
    'Accept': 'application/json',
    'User-Agent': GHC_CONFIG.USER_AGENT,
    'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
    'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
  };
}

export function getDeviceCodeHeaders(): Record<string, string> {
  return {
    'Accept': 'application/json',
    'User-Agent': GHC_CONFIG.USER_AGENT
  };
}

// Dynamic configuration updates
export class GhcConfigManager {
  private static instance: GhcConfigManager;
  private config = { ...GHC_CONFIG };
  
  static getInstance(): GhcConfigManager {
    if (!GhcConfigManager.instance) {
      GhcConfigManager.instance = new GhcConfigManager();
    }
    return GhcConfigManager.instance;
  }
  
  getConfig() {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<typeof GHC_CONFIG>) {
    this.config = { ...this.config, ...updates };
  }
  
  resetConfig() {
    this.config = { ...GHC_CONFIG };
  }
  
  validateConfig() {
    return validateGhcConfig();
  }
  
  // New: Get standardized headers
  getStandardHeaders(authToken?: string): Record<string, string> {
    return getStandardHeaders(authToken);
  }
  
  getCopilotTokenHeaders(githubAccessToken: string): Record<string, string> {
    return getCopilotTokenHeaders(githubAccessToken);
  }
  
  getDeviceCodeHeaders(): Record<string, string> {
    return getDeviceCodeHeaders();
  }
}

export const ghcConfigManager = GhcConfigManager.getInstance();