import { connectRenderToMain } from './base';

/** Serializable plugin data returned to the renderer (matches LoadedPlugin). */
export interface PluginInfo {
  id: string;
  manifest: {
    name: string;
    version: string;
    description: string;
    author?: { name: string; email?: string; url?: string };
    skills?: string | string[];
    mcpServers?: Record<string, unknown>;
    hooks?: Record<string, unknown[]>;
    commands?: Array<{ name: string; description?: string; promptBody: string; sourcePath: string; allowedTools?: string[] }>;
    agents?: Array<{ name: string; description?: string; model?: string; systemPrompt: string; sourcePath: string }>;
  };
  path: string;
  enabled: boolean;
  injectedMcpServers: string[];
  injectedSkills: string[];
}

export interface PluginResult {
  success: boolean;
  plugins?: PluginInfo[];
  error?: string;
}

type RenderToMain = {
  getPlugins: {
    call: [];
    return: PluginResult;
  };
  install: {
    call: [];
    return: PluginResult;
  };
  installFromPath: {
    call: [sourceDir: string];
    return: PluginResult;
  };
  uninstall: {
    call: [pluginId: string];
    return: PluginResult;
  };
  enableForAgent: {
    call: [pluginId: string, userAlias: string, chatId: string];
    return: PluginResult;
  };
  disableForAgent: {
    call: [pluginId: string, userAlias: string, chatId: string];
    return: PluginResult;
  };
  enable: {
    call: [pluginId: string];
    return: PluginResult;
  };
  disable: {
    call: [pluginId: string];
    return: PluginResult;
  };
  restart: {
    call: [pluginId: string];
    return: PluginResult;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('plugin');
