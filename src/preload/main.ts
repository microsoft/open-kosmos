import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { InvokeFn, OnOff } from '@shared/ipc/base';
import type { McpAuthClientIdRequestPayload, McpAuthClientIdResponse } from '@shared/types/mcpAuth';
import invokeScreenshot from './screenshot/invoke';
import invokeScheduler from './scheduler/invoke';
import invokeBrowserControl from './browserControl/invoke';
import { createMemexPreloadApi } from './memex/api';
import invokeExternalAgent from './externalAgent/invoke';
import invokeBuddy from './buddy/invoke';
import invokePlugin from './plugin/invoke';
import { UserMessage } from '@shared/types/chatTypes';

// Define the API that will be exposed to the renderer process
export interface ElectronAPI {
  // App information
  getVersion: () => Promise<string>;
  getName: () => Promise<string>;
  isDev: () => Promise<boolean>;

  // 🚀 New:Check if app is fully ready
  isReady: () => Promise<{ success: boolean; data: boolean }>;
  onAppReady: (callback: (isReady: boolean) => void) => () => void;

  // Platform information
  platform: string;

  // 🔥 New:Platform detection API (obtained from main process, used for Windows ARM detection)
  getPlatformInfo: () => Promise<{
    platform: string;
    arch: string;
    isWindowsArm: boolean;
  }>;

  getCrashCaptureStatus: () => Promise<{
    currentSessionId: string;
    crashRootDir: string;
    crashDumpsDir: string;
    hasRecoveredCrash: boolean;
    recoveredCrash: {
      eventType: 'recovered-unclean-exit';
      sessionId: string;
      previousSessionId: string;
      detectedAt: string;
      startedAt: string;
      pid: number;
      appVersion: string;
      bundlePath: string;
    } | null;
  }>;

  recordCrashBreadcrumb: (
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;

  reportRendererError: (report: {
    kind: 'error' | 'unhandledrejection' | 'react-error-boundary';
    message: string;
    stack?: string;
    source?: string;
    lineno?: number;
    colno?: number;
    url?: string;
    componentStack?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;

  // 🔥 New: get userData path - for local resource access (e.g., FRE videos)
  getUserDataPath: () => Promise<string>;
  getInstallationDeviceId: () => Promise<string>;

  // User profile management - removed V1 handlers
  // createUserProfile and getUserProfilePath no longer needed in V2

  // Profile APIs
  profile: {
    getLLMApiSettings: (alias: string) => Promise<any>;
    addLLMApiSettings: (alias: string, settings: any) => Promise<boolean>;
    updateLLMApiSettings: (alias: string, settings: any) => Promise<boolean>;
    getAllMCPServers: (alias: string) => Promise<any[]>;
    getMCPServerByName: (alias: string, serverName: string) => Promise<any>;
    addMCPServer: (alias: string, server: any) => Promise<boolean>;
    updateMCPServerByName: (
      alias: string,
      serverName: string,
      updates: any,
    ) => Promise<boolean>;
    deleteMCPServerByName: (
      alias: string,
      serverName: string,
    ) => Promise<boolean>;
    // V1 GHC operations removed - now handled through V2 Chat Agent operations
    getProfile: (
      alias: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getProfilesWithGhcAuth: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    onCacheUpdated: (
      callback: (data: {
        alias: string;
        profile: any;
        timestamp: number;
      }) => void,
    ) => () => void;
    // 🔥 New: listen for auto-select ChatSession IPC event
    onAutoSelectChatSession: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        timestamp: number;
      }) => void,
    ) => () => void;
    onChatSessionStoreSessionCreated: (
      callback: (data: {
        alias: string;
        chatId: string;
        session: any;
        timestamp: number;
      }) => void,
    ) => () => void;
    onChatSessionStoreMetadataPatched: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        metadata: any;
        timestamp: number;
      }) => void,
    ) => () => void;
    onChatSessionStoreFilePatched: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        file: any;
        timestamp: number;
      }) => void,
    ) => () => void;
    onChatSessionStoreSessionDeleted: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        timestamp: number;
      }) => void,
    ) => () => void;
    getChatUnreadSummary: (
      alias: string,
      chatId: string,
    ) => Promise<{
      success: boolean;
      data?: {
        chatId: string;
        userUnreadCount: number;
        scheduledUnreadCount: number;
        updatedAt: string;
      };
      error?: string;
    }>;
    onChatUnreadSummaryChanged: (
      callback: (data: {
        alias: string;
        summary: {
          chatId: string;
          userUnreadCount: number;
          scheduledUnreadCount: number;
          updatedAt: string;
        };
        timestamp: number;
      }) => void,
    ) => () => void;

    // Primary Agent operations
    setPrimaryAgent: (
      agentName: string,
    ) => Promise<{ success: boolean; error?: string }>;

    // FRE (First Run Experience) operations
    updateFreDone: (
      alias: string,
      freDone: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    updateConfirmationSettings: (
      alias: string,
      settings: any,
    ) => Promise<{ success: boolean; error?: string }>;

    // MCP operations through ProfileCacheManager
    addMcpServer: (
      serverName: string,
      serverConfig: any,
    ) => Promise<{ success: boolean; error?: string }>;
    updateMcpServer: (
      serverName: string,
      serverConfig: any,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteMcpServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    connectMcpServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    reconnectMcpServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    disconnectMcpServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;

    // ChatConfig operations through ProfileCacheManager
    addChatConfig: (
      chatConfig: any,
    ) => Promise<{ success: boolean; error?: string }>;
    duplicateChatConfig: (
      sourceChatId: string,
      newAgentName: string,
    ) => Promise<{ success: boolean; newChatId?: string; knowledgeCopyFailed?: boolean; scheduleCopyFailed?: boolean; error?: string }>;
    updateChatConfig: (
      chatId: string,
      chatConfig: any,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteChatConfig: (
      chatId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getChatConfig: (
      chatId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getAllChatConfigs: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    updateChatAgent: (
      chatId: string,
      agentUpdates: any,
    ) => Promise<{ success: boolean; error?: string }>;

    // Archive Agent operations
    archiveChatConfig: (
      chatId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    unarchiveChatConfig: (
      chatId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getArchivedAgents: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;

    // ChatSession operations through ProfileCacheManager
    saveChatSession: (
      alias: string,
      chatId: string,
      chatSessionFile: any,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteChatSession: (
      alias: string,
      chatId: string,
      sessionId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getChatSessionFile: (
      alias: string,
      chatId: string,
      sessionId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    renameChatSession: (
      alias: string,
      chatId: string,
      sessionId: string,
      newTitle: string,
    ) => Promise<{ success: boolean; error?: string }>;
    setChatSessionStarred: (
      alias: string,
      chatId: string,
      sessionId: string,
      starred: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    getChatSessions: (
      alias: string,
      chatId: string,
      minCount?: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getMoreChatSessions: (
      alias: string,
      chatId: string,
      fromMonthIndex: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getChatSession: (
      chatId: string,
      sessionId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    createChatSession: (
      chatId: string,
      title?: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
  };

  // SigninOps APIs (unified authentication operations)
  signin: {
    getValidUsersForSignin: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    clearTokens: (
      alias: string,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteAuthJson: (
      alias: string,
    ) => Promise<{ success: boolean; error?: string }>;
    updateAuthJson: (
      alias: string,
      authData: any,
    ) => Promise<{ success: boolean; error?: string }>;
    getProfilesWithGhcAuth: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
  };

  // Main process auth management APIs (MainAuthManager) - V2.0 AuthData architecture
  auth: {
    // New naming (AuthData architecture)
    getLocalActiveAuths: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    setCurrentAuth: (
      authData: any,
    ) => Promise<{ success: boolean; error?: string }>;
    getCurrentAuth: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    destroyCurrentAuth: () => Promise<{ success: boolean; error?: string }>;
    getCopilotToken: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    getGitHubToken: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    refreshCopilotToken: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    onAuthChanged: (callback: (data: any) => void) => () => void;

    // Legacy naming (backward compatible - mapped to new methods)
    getLocalActiveSessions: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    setCurrentSession: (
      session: any,
    ) => Promise<{ success: boolean; error?: string }>;
    getCurrentSession: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    destroyCurrentSession: () => Promise<{ success: boolean; error?: string }>;
    getAccessToken: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    refreshCurrentSessionToken: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    onSessionChanged: (callback: (data: any) => void) => () => void;

    // Token monitoring
    // Note: startTokenMonitoring has been removed - Token monitoring is now automatically started by setCurrentAuth()
    stopTokenMonitoring: () => Promise<{ success: boolean; error?: string }>;
    getMonitoringStatus: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    manualTokenCheck: () => Promise<{ success: boolean; error?: string }>;
    onTokenMonitor: (callback: (data: any) => void) => () => void;

    // GitHub Copilot OAuth Device Flow - complete flow
    startGhcDeviceFlow: () => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;

    // Unified sign-out API - coordinate cleanup of all components
    signOut: () => Promise<{ success: boolean; error?: string }>;

    // Device Flow event listeners
    onDeviceCodeGenerated: (callback: (deviceCode: any) => void) => void;
    onDeviceFlowSuccess: (callback: (data: any) => void) => void;
    onDeviceFlowError: (callback: (data: any) => void) => void;
    removeDeviceFlowListeners: () => void;
  };

  // LLM APIs - AI assistant features
  llm: {
    // System Prompt optimization
    improveSystemPrompt: (
      userInputPrompt: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // MCP config formatting
    formatMcpConfig: (
      userInputMcpConfig: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // Chat session title generation
    generateChatTitle: (
      userMessage: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // File name generation (auto-generate file name and extension based on content)
    generateFileName: (
      content: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // Document summary generation (generate LLM summary from extracted document text content)
    generateDocumentSummary: (
      fileName: string,
      content: string,
      truncated?: boolean,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // Text embedding
    embedText: (
      text: string,
    ) => Promise<{ success: boolean; data?: number[]; error?: string }>;

    // Batch text embedding
    embedBatch: (
      texts: string[],
    ) => Promise<{ success: boolean; data?: number[][]; error?: string }>;

  };

  // Models APIs - GitHub Copilot model management
  models: {
    // Get all GitHub Copilot models
    getAllModels: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;

    // Get list of models used by OpenKosmos
    getAllOpenKosmosUsedModels: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;

    // Get a single model by ID
    getModelById: (
      modelId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // Get model capability information
    getModelCapabilities: (
      modelId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;

    // Validate whether model ID is valid
    validateModelId: (
      modelId: string,
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>;

    // Get default model ID
    getDefaultModel: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;

    // Determine if it is a reasoning model
    isReasoningModel: (
      modelId: string,
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>;

    // Listen for backend model data update notifications (passive sync mode)
    onModelsUpdated: (
      callback: (data: { count: number; timestamp: number }) => void,
    ) => () => void;
  };

  // Feature Flags APIs - developer feature toggles (read-only)
  featureFlags: {
    // Get values of all feature flags
    getAllFlags: () => Promise<{
      success: boolean;
      data?: Record<string, boolean>;
      error?: string;
    }>;

    // Check if a single feature flag is enabled
    isEnabled: (
      flagName: string,
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };

  // MCP Client Manager APIs
  mcp: {
    getServerStatus: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    connectServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    disconnectServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    reconnectServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    addServer: (
      serverName: string,
      mcpServer: any,
    ) => Promise<{ success: boolean; data?: string; error?: string }>;
    updateServer: (
      serverName: string,
      mcpServer: any,
    ) => Promise<{ success: boolean; data?: string; error?: string }>;
    deleteServer: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getAllTools: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    executeTool: (
      toolName: string,
      toolArgs: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    onServerStatesUpdated: (
      callback: (serverStates: any[]) => void,
    ) => () => void;

    // Log management APIs
    getServerLogs: (
      serverName: string,
      filter?: any,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getAllServerLogStats: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    clearServerLogs: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    setServerLoggingEnabled: (
      serverName: string,
      enabled: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    openServerLogFile: (
      serverName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    onServerLogUpdate: (
      callback: (data: { serverName: string; entry: any }) => void,
    ) => () => void;

    /**
     * Dev-facing: reset stored OAuth credentials for a single MCP server.
     * Disconnects the server first; the next connect re-runs OAuth.
     *
     *   `'tokens'` (default): drop tokens only — re-runs PKCE on same OAuth app
     *   `'all'`:              drop tokens + clientId — re-shows DCR-fallback dialog
     *
     * Not currently surfaced in the UI; intended for use from DevTools
     * console when testing different accounts / OAuth apps.
     */
    resetOAuth: (
      serverName: string,
      scope?: 'tokens' | 'all',
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Runtime Environment Management
  runtime: {
    setMode: (mode: 'system' | 'internal') => Promise<any>;
    install: (tool: 'bun' | 'uv', version: string) => Promise<{ success: boolean; error?: string }>;
    checkStatus: () => Promise<{
      bun: boolean;
      uv: boolean;
      bunPath: string;
      uvPath: string;
    }>;
    checkGitVersion: () => Promise<{
      installed: boolean;
      version: string | null;
      path: string | null;
    }>;
    listPythonVersions: () => Promise<any[]>;
    /** Fast synchronous Python version scan - typically < 50ms, use for FRE */
    listPythonVersionsFast: () => Promise<{ version: string; path: string; status: 'installed'; impl: string; semver: string }[]>;
    installPythonVersion: (version: string) => Promise<void>;
    uninstallPythonVersion: (version: string) => Promise<void>;
    setPinnedPythonVersion: (version: string | null) => Promise<void>;
    cleanUvCache: () => Promise<void>;
  };

  // OpenKosmos Placeholder APIs - handle @OpenKosmos_ placeholder variables
  openkosmos: {
    replacePlaceholders: (envObj: Record<string, string>) => Promise<{
      success: boolean;
      data?: Record<string, string>;
      error?: string;
    }>;
    parseUserInputPlaceholders: (config: any) => Promise<{
      success: boolean;
      data?: {
        fields: Array<{
          key: string;
          originalValue: string;
          type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
          control: 'folder' | 'file' | 'text';
          varName: string;
          isRequired: boolean;
          label: string;
          defaultValue?: string;
        }>;
        hasUserInputFields: boolean;
      };
      error?: string;
    }>;
  };

  // Skill Library APIs
  skillLibrary: {
    validateSkill: (
      skillName: string,
    ) => Promise<{ success: boolean; error?: string; hasExisting?: boolean; existingSkill?: any }>;
    addSkillFromDevice: (selectedPath?: string, options?: { chatId?: string; applyToCurrentAgent?: boolean; agentName?: string; requestSource?: string; selectionMode?: 'artifact' | 'folder' }) => Promise<{
      success: boolean;
      skillName?: string;
      skillVersion?: string;
      message?: string;
      error?: string;
      isOverwrite?: boolean;
      inputType?: 'zip' | 'skill' | 'folder';
      resolution?: 'installed_and_callable' | 'installed_but_not_applied' | 'installed_but_needs_target_selection' | 'already_callable' | 'failed';
      currentChat?: { chatId?: string; agentName?: string; callable: boolean };
      activation?: {
        attempted: boolean;
        success: boolean;
        appliedTargets: Array<{ chatId: string; agentName: string }>;
        skippedTargets: Array<{ chatId: string; agentName: string; reason: string }>;
      };
    }>;
    installSkillFromFilePath: (filePath: string, options?: {
      chatId?: string;
      applyToCurrentAgent?: boolean;
      agentName?: string;
      requestSource?: string;
    }) => Promise<{
      success: boolean;
      skillName?: string;
      skillVersion?: string;
      message?: string;
      error?: string;
      isOverwrite?: boolean;
      inputType?: 'zip' | 'skill' | 'folder';
      resolution?: 'installed_and_callable' | 'installed_but_not_applied' | 'installed_but_needs_target_selection' | 'already_callable' | 'failed';
      currentChat?: { chatId?: string; agentName?: string; callable: boolean };
      activation?: {
        attempted: boolean;
        success: boolean;
        appliedTargets: Array<{ chatId: string; agentName: string }>;
        skippedTargets: Array<{ chatId: string; agentName: string; reason: string }>;
      };
    }>;
    updateSkillFromDevice: (
      skillName: string,
    ) => Promise<{
      success: boolean;
      skillName?: string;
      error?: string;
      inputType?: 'zip' | 'skill' | 'folder';
    }>;
    applySkillToAgents: (
      skillName: string,
      targets: Array<{ chatId: string; agentName: string }>,
    ) => Promise<{
      success: boolean;
      skillName: string;
      message: string;
      appliedCount: number;
      alreadyAppliedCount: number;
      failedCount: number;
      appliedTargets: Array<{ chatId: string; agentName: string }>;
      skippedTargets: Array<{ chatId: string; agentName: string; reason: string }>;
      error?: string;
    }>;
    showOverwriteConfirmDialog: (
      skillName: string,
    ) => Promise<{ success: boolean; confirmed?: boolean; error?: string }>;
  };

  // Builtin Tools APIs
  builtinTools: {
    execute: (
      toolName: string,
      args: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getAllTools: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    isBuiltinTool: (
      toolName: string,
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };

  // Skills APIs
  skills: {
    getSkillMarkdown: (
      skillName: string,
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    getSkillDirectoryContents: (
      skillName: string,
      relativePath?: string,
    ) => Promise<{
      success: boolean;
      data?: {
        currentPath: string;
        parentPath: string | null;
        items: Array<{
          name: string;
          path: string;
          isDirectory: boolean;
          isFile: boolean;
          size: number;
          modifiedTime: string;
          extension: string | null;
        }>;
      };
      error?: string;
    }>;
    getSkillFileContent: (
      skillName: string,
      relativePath: string,
    ) => Promise<{
      success: boolean;
      data?: {
        fileName: string;
        path: string;
        extension: string;
        content: string | null;
        isSupported: boolean;
        size: number;
        modifiedTime: string;
      };
      error?: string;
    }>;
    deleteSkill: (
      skillName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    openSkillFolder: (
      skillName: string,
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Plugin management APIs
  plugin: {
    invoke: InvokeFn;
  };

  // Sub-Agent APIs
  subAgent: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    add: (config: any) => Promise<{ success: boolean; error?: string }>;
    update: (
      name: string,
      config: any,
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (name: string) => Promise<{ success: boolean; error?: string }>;
    /** Import a Claude Code .md file as a sub-agent */
    importFromFile: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    /** Export a sub-agent as Claude Code standard format */
    exportAsClaudeCode: (name: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    /** Open agent directory in system file explorer */
    openInExplorer: (name: string) => Promise<{ success: boolean; error?: string }>;
    /** Trigger file system scan and sync with profile index */
    syncFromDisk: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    /** Returns cleanup function to unsubscribe */
    onStateUpdate: (callback: (state: any) => void) => () => void;
  };

  // Sub-Agent Task Streaming APIs
  subAgentTask: {
    listForSession: (parentSessionId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    open: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    close: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    resolveByCorrelationId: (correlationId: string) => Promise<{ success: boolean; data?: string | null; error?: string }>;
    onStreamingChunk: (callback: (chunk: any) => void) => () => void;
    onTaskCreated: (callback: (data: any) => void) => () => void;
    onTaskUpdated: (callback: (data: any) => void) => () => void;
  };

  // AgentChat APIs (Main Process)
  agentChat: {
    initialize: (
      alias: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getCurrentInstance: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    getChatHistory: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    getDisplayMessages: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    startNewChatFor: (
      chatId: string,
      _options?: {
        sayHiMessageConfig?: {
          markdownContent: string;
          initialDelay?: number;
          retryDelay?: number;
          maxRetries?: number;
        };
      },
    ) => Promise<{ success: boolean; chatSessionId?: string; error?: string }>;
    streamMessage: (
      message: UserMessage,
      targetChatSessionId?: string,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    // 🔥 Retry the last failed conversation
    retryChat: (chatSessionId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    canEditUserMessage: (
      chatSessionId: string,
      messageId: string,
    ) => Promise<{ success: boolean; data?: { canEdit: boolean; error?: string }; error?: string }>;
    editUserMessage: (
      chatSessionId: string,
      messageId: string,
      updatedMessage: any,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    // 🔥 New: cancel chat operation
    cancelChat: (
      chatId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    cancelActiveToolExecution: (
      chatSessionId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    syncChatHistory: (
      messages: any[],
    ) => Promise<{ success: boolean; error?: string }>;
    getCurrentChatId: () => Promise<{
      success: boolean;
      data?: string | null;
      error?: string;
    }>;
    refreshCurrentInstance: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    switchToChatSession: (
      chatId: string,
      chatSessionId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    // 🔥 New: cancel specified ChatSession operation
    cancelChatSession: (
      chatSessionId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getCurrentChatSession: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    // 🔥 New: get current ChatSession status (frontend-initiated call)
    getChatStatusInfo: () => Promise<{
      success: boolean;
      data?: { chatStatus: string; agentName: string; chatId: string };
      error?: string;
    }>;
    // 🔥 New: get current Context Token usage (frontend-initiated call)
    getCurrentContextTokenUsage: () => Promise<{
      success: boolean;
      data?: {
        tokenCount: number;
        totalMessages: number;
        contextMessages: number;
        compressionRatio: number;
      };
      error?: string;
    }>;
    onStreamingMessage: (callback: (message: any) => void) => () => void;
    onToolUse: (callback: (toolName: string) => void) => () => void;
    onToolResult: (callback: (result: any) => void) => () => void;
    onToolMessageAdded: (callback: (data: any) => void) => () => void;
    onContextChange: (callback: (stats: any) => void) => () => void;
    onInteractionRequest: (callback: (request: any) => void) => () => void;
    sendInteractionResponse: (response: any) => Promise<{ success: boolean; error?: string }>;
    onInteractionProcessed: (callback: (data: any) => void) => () => void;
    onChatStatusChanged: (
      callback: (data: {
        chatId: string;
        chatSessionId: string;
        chatStatus: string;
        agentName?: string;
        timestamp?: string;
      }) => void,
    ) => () => void;
    onStreamingChunk: (callback: (chunk: any) => void) => () => void;
    // 🔥 New: IPC events required by agentChatSessionCacheManager
    onCurrentChatSessionIdChanged: (
      callback: (data: {
        chatId: string | null;
        chatSessionId: string | null;
      }) => void,
    ) => () => void;
    onChatSessionCacheCreated: (
      callback: (data: {
        chatSessionId: string;
        chatId: string;
        initialData?: any;
      }) => void,
    ) => () => void;
    onChatSessionCacheDestroyed: (
      callback: (data: { chatSessionId: string }) => void,
    ) => () => void;
    // 🔥 New: clean up AgentChat instance when deleting ChatSession
    removeAgentChatInstance: (
      chatSessionId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    // 🔥 New: Fork ChatSession - duplicate ChatSession and switch to the new one
    forkChatSession: (
      chatId: string,
      sourceChatSessionId: string,
    ) => Promise<{ success: boolean; chatSessionId?: string; error?: string }>;
    importChatSession: (
      chatId: string,
    ) => Promise<{ success: boolean; importedSessions?: number; importedSessionId?: string; importedWorkspaceFiles?: number; error?: string }>;
    // 🔥 New: Replace file path references in current ChatSession (used when moving files to Knowledge Base)
    replaceFilePathInSession: (
      oldPath: string,
      newPath: string,
    ) => Promise<{ success: boolean; replacedCount: number; error?: string }>;
  };

  // Chroma Server APIs
  chroma: {
    startServer: (userAlias: string) => Promise<{
      success: boolean;
      data?: { serverUrl: string };
      error?: string;
    }>;
    stopServer: () => Promise<{ success: boolean; error?: string }>;
    getServerStatus: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    restartServer: (userAlias: string) => Promise<{
      success: boolean;
      data?: { serverUrl: string };
      error?: string;
    }>;
  };

  // ChatSessionOps APIs (main process file operations)
  chatSessionOps?: {
    readChatSession: (
      sessionId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    writeChatSession: (
      sessionData: any,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteChatSession: (
      sessionId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    listChatSessions: () => Promise<{
      success: boolean;
      data?: string[];
      error?: string;
    }>;
    getChatSessionMetadata: (
      sessionId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    // 🔥 New: download ChatSession to Downloads directory
    downloadChatSession: (
      alias: string,
      chatId: string,
      sessionId: string,
      title: string,
    ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    getChatSessionFilePath: (
      alias: string,
      chatId: string,
      sessionId: string,
    ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  };

  // Window management
  window?: {
    minimize: () => void;
    maximize: () => void;
    unmaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onWindowStateChanged: (callback: (state: string) => void) => () => void;
    showAppMenu: (x: number, y: number) => Promise<boolean>; // 🔥 New
    setSize: (width: number, height: number) => Promise<boolean>;
    getSize: () => Promise<{ width: number; height: number }>;
    setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
    isAlwaysOnTop: () => Promise<boolean>;
    setMinSize: (width: number, height: number) => Promise<boolean>;
    setMaxSize: (width: number, height: number) => Promise<boolean>;
    getMinSize: () => Promise<{ width: number; height: number }>;
    getMaxSize: () => Promise<{ width: number; height: number }>;
    zoomIn: () => Promise<number>;
    zoomOut: () => Promise<number>;
    resetZoom: () => Promise<number>;
    getZoomLevel: () => Promise<number>;
    onZoomChanged: (callback: (level: number) => void) => () => void;
    isFullScreen: () => Promise<boolean>;
    onFullScreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
  };

  // Logger management
  logger?: {
    manualFlush: () => Promise<{ success: boolean; error?: string }>;
    sendLog: (log: any) => void;
  };

  // Folder management
  folder?: {
    openLogs: () => Promise<{ success: boolean; error?: string }>;
    openProfile: (
      alias: string,
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Workspace management
  workspace?: {
    selectFolder: () => Promise<{
      success: boolean;
      folderPath?: string;
      error?: string;
    }>;
    getFileTree: (
      workspacePath: string,
      options?: { maxDepth?: number; ignorePatterns?: string[] },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    clearFileTreeCache: (
      workspacePath?: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getDirectoryChildren: (
      dirPath: string,
      options?: { ignorePatterns?: string[] },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    copyPath: (
      sourcePath: string,
      destPath: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    copyPaths: (
      sourcePaths: string[],
      destPath: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => Promise<{ success: boolean; data?: any; canceled?: boolean; error?: string }>;
    movePath: (
      sourcePath: string,
      destPath: string,
      options?: { force?: boolean },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    startWatch: (
      workspacePath: string,
      options?: { excludes?: string[]; includes?: string[] },
    ) => Promise<{ success: boolean; error?: string }>;
    stopWatch: () => Promise<{ success: boolean; error?: string }>;
    getWatcherStats: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    searchFiles: (query: {
      folder?: string;
      pattern?: string;
      maxResults?: number;
      fuzzy?: boolean;
      searchTarget?: 'files' | 'folders' | 'both';
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    onFileChanged: (callback: (changes: any[]) => void) => () => void;
    onWatchError: (callback: (error: any) => void) => () => void;
    openPath: (
      targetPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    showInFolder: (
      targetPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getDefaultWorkspacePath: (
      alias: string,
      chatId: string,
    ) => Promise<{ success: boolean; data?: string; error?: string }>;
  };

  // File system operations for VSCode import and unified profile storage
  fs?: {
    exists: (filePath: string) => Promise<boolean>;
    listDir: (dirPath: string) => Promise<{
      success: boolean;
      entries?: Array<{
        name: string;
        isDirectory: boolean;
        isFile: boolean;
      }>;
      error?: string;
    }>;
    access: (
      filePath: string,
    ) => Promise<{ readable: boolean; writable: boolean }>;
    readFile: (
      filePath: string,
      encoding?: string,
    ) => Promise<{
      success: boolean;
      content?: string;
      size?: number;
      lastModified?: number;
      error?: string;
    }>;
    writeFile: (
      filePath: string,
      content: string,
      encoding?: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => Promise<{ success: boolean; filePath?: string; skipped?: boolean; canceled?: boolean; replaced?: boolean; renamed?: boolean; error?: string }>;
    stat: (filePath: string) => Promise<{
      success: boolean;
      stats?: {
        size: number;
        isFile: boolean;
        isDirectory: boolean;
        mtime: number;
        atime: number;
        birthtime: number;
      };
      error?: string;
    }>;
    expandPath: (path: string) => Promise<string>;
    selectFile: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // New: API for getting complete file metadata
    getFileMetadata: (filePath: string) => Promise<{
      success: boolean;
      metadata?: {
        fullPath: string;
        fileName: string;
        fileSize: number;
        fileType: string;
        mimeType: string;
        lineCount?: number;
        lastModified: number;
        isTextFile: boolean;
      };
      error?: string;
    }>;
    // New: API for selecting multiple files (supports file attachments)
    selectFiles: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      allowMultiple?: boolean;
    }) => Promise<{
      success: boolean;
      filePaths?: string[];
      error?: string;
    }>;
    // New: delete files or directories (supports multiple paths, recursive directory deletion)
    deletePaths: (paths: string[]) => Promise<{
      success: boolean;
      results?: Array<{ path: string; success: boolean; error?: string }>;
      successCount?: number;
      failCount?: number;
      error?: string;
    }>;
    // New: download file from URL to local path
    downloadFile: (url: string, destPath: string) => Promise<{
      success: boolean;
      filePath?: string;
      size?: number;
      error?: string;
    }>;
    // 🔥 New: get full path of dragged file (resolve path issue under contextIsolation)
    // Use Electron webUtils.getPathForFile() API (Electron 26+)
    getPathForFile: (file: File) => string;
  };

  // Debug tools
  debug?: {
    openWindow: () => Promise<{ success: boolean; error?: string }>;
  };

  // Update management
  update: {
    checkForUpdates: (
      silent?: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    downloadUpdate: (
      downloadUrl?: string,
    ) => Promise<{ success: boolean; error?: string }>;
    quitAndInstall: (filePath?: string) => void;
    getVersion: () => Promise<string>;
    skipVersion: (
      version: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getPreferences: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    updatePreferences: (
      preferences: any,
    ) => Promise<{ success: boolean; error?: string }>;
    onUpdateEvent: (
      channel: string,
      callback: (data?: any) => void,
    ) => () => void;
  };

  // Startup Update - check and install library updates on startup
  startupUpdate: {
    checkAndInstallUpdates: () => Promise<{
      success: boolean;
      data?: {
        success: boolean;
        hasUpdates: boolean;
        updatedMcpCount: number;
        updatedSkillCount: number;
        updatedAgentCount: number;
        errors: string[];
      };
      error?: string;
    }>;
    onProgress: (callback: (progress: {
      step: string;
      message: string;
      progress: number;
      error?: string;
    }) => void) => () => void;
  };

  // Quick Start Image Cache APIs
  quickStartImageCache?: {
    // Get or cache image (download and cache if not present)
    getOrCache: (
      agentName: string,
      imageUrl: string,
    ) => Promise<{
      success: boolean;
      cachedUrl?: string | null;
      error?: string;
    }>;
    // Clear image cache for specified Agent
    clearAgent: (
      agentName: string,
    ) => Promise<{ success: boolean; error?: string }>;
    // Clear all image cache
    clearAll: () => Promise<{ success: boolean; error?: string }>;
  };

  // Screenshot APIs
  screenshot: {
    invoke: InvokeFn,
  };

  // External Agent APIs
  externalAgent: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Whisper STT APIs (Voice Input)
  whisper?: {
    getAllModelStatus: () => Promise<{
      success: boolean;
      data?: Array<{
        size: string;
        downloaded: boolean;
        path?: string;
        actualSize?: number;
      }>;
      error?: string;
    }>;
    getModelStatus: (size: string) => Promise<{
      success: boolean;
      data?: {
        size: string;
        downloaded: boolean;
        path?: string;
        actualSize?: number;
      };
      error?: string;
    }>;
    getAllModelInfo: () => Promise<{
      success: boolean;
      data?: Array<{
        size: string;
        fileName: string;
        fileSize: number;
        fileSizeDisplay: string;
        downloadUrl: string;
        description: string;
      }>;
      error?: string;
    }>;
    downloadModel: (size: string) => Promise<{ success: boolean; error?: string }>;
    cancelDownload: (size: string) => Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }>;
    deleteModel: (size: string) => Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }>;
    getModelPath: (size: string) => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    isDownloading: () => Promise<{
      success: boolean;
      data?: {
        isDownloading: boolean;
        activeDownloads: string[];
      };
      error?: string;
    }>;
    onDownloadProgress: (callback: (progress: {
      model: string;
      downloaded: number;
      total: number;
      percent: number;
    }) => void) => () => void;
    onDownloadComplete: (callback: (data: {
      model: string;
      path: string;
    }) => void) => () => void;
    onDownloadError: (callback: (data: {
      model: string;
      error: string;
    }) => void) => () => void;
    onDownloadCancelled: (callback: (data: {
      model: string;
    }) => void) => () => void;
    // Transcription APIs
    transcribe: (pcmData: Float32Array, modelSize: string, options?: {
      language?: string;
      useGPU?: boolean;
      enableVAD?: boolean;
      threads?: number;
      translate?: boolean;
    }) => Promise<{
      success: boolean;
      data?: {
        text: string;
        segments?: Array<{
          start: string;
          end: string;
          text: string;
        }>;
      };
      error?: string;
    }>;
    isAvailable: () => Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }>;
    // Streaming transcription APIs
    startStreaming: (modelSize: string, options?: {
      language?: string;
      useGPU?: boolean;
      threads?: number;
      translate?: boolean;
      vadThreshold?: number;
      silenceDuration?: number;
      minSpeechDuration?: number;
    }) => Promise<{
      success: boolean;
      data?: { sessionId: string };
      error?: string;
    }>;
    processChunk: (sessionId: string, pcmData: Float32Array) => Promise<{
      success: boolean;
      error?: string;
    }>;
    stopStreaming: (sessionId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    cancelStreaming: (sessionId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    isStreamingActive: (sessionId: string) => Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }>;
    onStreamingUpdate: (callback: (update: {
      sessionId: string;
      type: 'interim' | 'final' | 'error' | 'started' | 'stopped';
      text?: string;
      segments?: Array<{ start: string; end: string; text: string }>;
      error?: string;
      duration?: number;
    }) => void) => () => void;
  };

  // Voice Input Settings APIs
  voiceInput?: {
    getSettings: () => Promise<{
      success: boolean;
      data?: {
        whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'turbo';
        language: string;
      };
      error?: string;
    }>;
    updateSettings: (settings: {
      whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'turbo';
      language?: string;
    }) => Promise<{ success: boolean; error?: string }>;
  };

  // Native Module on-demand download management
  nativeModule?: {
    getStatus: (moduleKey: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    ensureDownloaded: (moduleKey: string) => Promise<{ success: boolean; data?: { localPath: string }; error?: string }>;
    cancelDownload: (moduleKey: string) => Promise<{ success: boolean; error?: string }>;
    deleteModule: (moduleKey: string) => Promise<{ success: boolean; error?: string }>;
    onDownloadStarted: (callback: (data: { packageName: string; url: string }) => void) => () => void;
    onDownloadProgress: (callback: (data: { packageName: string; bytesDownloaded: number; bytesTotal: number; percent: number }) => void) => () => void;
    onDownloadComplete: (callback: (data: { packageName: string; localPath: string }) => void) => () => void;
    onDownloadCancelled: (callback: (data: { packageName: string }) => void) => () => void;
    onDownloadError: (callback: (data: { packageName: string; error: string }) => void) => () => void;
  };

  // 🆕 App global config management API (app.json read/write handled uniformly by AppCacheManager)
  appConfig: {
    /** Get current AppConfig (includes runtimeEnvironment, updaterVersion, etc.) */
    getAppConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
    /** Update AppConfig (supports partial fields) */
    updateAppConfig: (updates: any) => Promise<{ success: boolean; error?: string }>;
    /** Listen to config change events pushed by appCacheManager, returns unsubscribe function */
    onConfigUpdated: (callback: (data: { config: any; timestamp: number }) => void) => () => void;
  };

  // Browser Control Settings and Management APIs
  browserControl?: {
    invoke: InvokeFn;
    onPhaseChange: (callback: (phase: string, message?: string) => void) => () => void;
    onDownloadProgress: (callback: (progress: { percent: number; transferred: string; total: string }) => void) => () => void;
    onUpdatePhaseChange: (callback: (phase: string, message?: string) => void) => () => void;
    onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: string; total: string }) => void) => () => void;
    onShowBrowserInstallConfirm: (callback: (data: { requestId: string; browserName: string }) => void) => () => void;
    onShowNativeServerDownloadConfirm: (callback: (data: { requestId: string }) => void) => () => void;
    onShowBrowserRestartConfirm: (callback: (data: { requestId: string; browserName: string }) => void) => () => void;
  };

  // DevTools MCP APIs
  devToolsMcp: {
    enable: () => Promise<{ success: boolean; error?: string }>;
    disable: () => Promise<{ success: boolean; error?: string }>;
    getStatus: () => Promise<{ success: boolean; data?: { enabled: boolean }; error?: string }>;
    getSettings: () => Promise<{ success: boolean; data?: { browser: 'chrome' | 'edge' }; error?: string }>;
    updateSettings: (settings: { browser?: 'chrome' | 'edge' }) => Promise<{ success: boolean; error?: string }>;
  };

  // Memex Memory (per-agent Zettelkasten)
  memex?: {
    invoke: InvokeFn;
    onPhaseChange: (callback: (phase: string) => void) => () => void;
  };

  // Scheduler Management
  scheduler: {
    invoke: InvokeFn;
  };

  // Buddy Companion
  buddy: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  mcpAuth: {
    onShowConsent: (callback: (data: { requestId: string; serverName: string; providerLabel: string }) => void) => () => void;
    respondConsent: (
      requestId: string,
      decision: 'cancel' | 'allow-this-time',
    ) => Promise<{ success: boolean; error?: string }>;
    /**
     * Surfaced when an OAuth provider does not support Dynamic Client
     * Registration and the user has not pre-configured a `clientId`.
     */
    onRequestClientId: (callback: (data: McpAuthClientIdRequestPayload) => void) => () => void;
    respondClientId: (
      requestId: string,
      response: McpAuthClientIdResponse,
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Generic event listening methods for main window IPC events
  on: (channel: string, callback: (data: any) => void) => () => void;
  off: (channel: string, callback: (data: any) => void) => void;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
export const electronAPI: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getName: () => ipcRenderer.invoke('app:getName'),
  isDev: () => ipcRenderer.invoke('app:isDev'),

  // 🚀 New: Ready check implementation
  isReady: () => ipcRenderer.invoke('app:isReady'),
  onAppReady: (callback: (isReady: boolean) => void) => {
    const listener = (event: any, isReady: boolean) => callback(isReady);
    ipcRenderer.on('app:ready', listener);
    return () => ipcRenderer.removeListener('app:ready', listener);
  },

  platform: process.platform,

  // 🔥 New: platform detection API implementation (get trusted platform info from main process)
  getPlatformInfo: () => ipcRenderer.invoke('app:getPlatformInfo'),

  // 🔥 New: get userData path - for local resource access (e.g., FRE videos)
  getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
  getInstallationDeviceId: () => ipcRenderer.invoke('app:getInstallationDeviceId'),

  getCrashCaptureStatus: () => ipcRenderer.invoke('app:getCrashCaptureStatus'),
  recordCrashBreadcrumb: (message: string, metadata?: Record<string, unknown>) =>
    ipcRenderer.invoke('app:recordCrashBreadcrumb', message, metadata),
  reportRendererError: (report) => ipcRenderer.invoke('app:reportRendererError', report),

  // 🆕 App global config management API implementation
  appConfig: {
    getAppConfig: () => ipcRenderer.invoke('app:getAppConfig'),
    updateAppConfig: (updates: any) => ipcRenderer.invoke('app:updateAppConfig', updates),
    onConfigUpdated: (callback: (data: { config: any; timestamp: number }) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('app:configUpdated', listener);
      return () => ipcRenderer.removeListener('app:configUpdated', listener);
    },
  },

  // V1 User profile operations removed
  profile: {
    getLLMApiSettings: (alias: string) =>
      ipcRenderer.invoke('profile:getLLMApiSettings', alias),
    addLLMApiSettings: (alias: string, settings: any) =>
      ipcRenderer.invoke('profile:addLLMApiSettings', alias, settings),
    updateLLMApiSettings: (alias: string, settings: any) =>
      ipcRenderer.invoke('profile:updateLLMApiSettings', alias, settings),
    getAllMCPServers: (alias: string) =>
      ipcRenderer.invoke('profile:getAllMCPServers', alias),
    getMCPServerByName: (alias: string, serverName: string) =>
      ipcRenderer.invoke('profile:getMCPServerByName', alias, serverName),
    addMCPServer: (alias: string, server: any) =>
      ipcRenderer.invoke('profile:addMCPServer', alias, server),
    updateMCPServerByName: (alias: string, serverName: string, updates: any) =>
      ipcRenderer.invoke(
        'profile:updateMCPServerByName',
        alias,
        serverName,
        updates,
      ),
    deleteMCPServerByName: (alias: string, serverName: string) =>
      ipcRenderer.invoke('profile:deleteMCPServerByName', alias, serverName),
    // V1 GHC operations removed - now handled through V2 Chat Agent operations
    getProfile: (alias: string) =>
      ipcRenderer.invoke('profile:getProfile', alias),
    updateConfirmationSettings: (alias: string, settings: any) =>
      ipcRenderer.invoke('profile:updateConfirmationSettings', alias, settings),
    getProfilesWithGhcAuth: () =>
      ipcRenderer.invoke('profile:getProfilesWithGhcAuth'),
    onCacheUpdated: (
      callback: (data: {
        alias: string;
        profile: any;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('profile:cacheUpdated', listener);
      return () => ipcRenderer.removeListener('profile:cacheUpdated', listener);
    },
    // 🔥 New: auto-select ChatSession IPC event implementation
    onAutoSelectChatSession: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('profile:autoSelectChatSession', listener);
      return () =>
        ipcRenderer.removeListener('profile:autoSelectChatSession', listener);
    },
    onChatSessionStoreSessionCreated: (
      callback: (data: {
        alias: string;
        chatId: string;
        session: any;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('chatSessionStore:sessionCreated', listener);
      return () => ipcRenderer.removeListener('chatSessionStore:sessionCreated', listener);
    },
    onChatSessionStoreMetadataPatched: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        metadata: any;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('chatSessionStore:metadataPatched', listener);
      return () => ipcRenderer.removeListener('chatSessionStore:metadataPatched', listener);
    },
    onChatSessionStoreFilePatched: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        file: any;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('chatSessionStore:filePatched', listener);
      return () => ipcRenderer.removeListener('chatSessionStore:filePatched', listener);
    },
    onChatSessionStoreSessionDeleted: (
      callback: (data: {
        alias: string;
        chatId: string;
        chatSessionId: string;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('chatSessionStore:sessionDeleted', listener);
      return () => ipcRenderer.removeListener('chatSessionStore:sessionDeleted', listener);
    },
    getChatUnreadSummary: (alias: string, chatId: string) =>
      ipcRenderer.invoke('profile:getChatUnreadSummary', alias, chatId),
    onChatUnreadSummaryChanged: (
      callback: (data: {
        alias: string;
        summary: {
          chatId: string;
          userUnreadCount: number;
          scheduledUnreadCount: number;
          updatedAt: string;
        };
        timestamp: number;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('chatSessionStore:unreadSummaryChanged', listener);
      return () => ipcRenderer.removeListener('chatSessionStore:unreadSummaryChanged', listener);
    },

    // MCP operations through ProfileCacheManager
    addMcpServer: (serverName: string, serverConfig: any) =>
      ipcRenderer.invoke('profile:addMcpServer', serverName, serverConfig),
    updateMcpServer: (serverName: string, serverConfig: any) =>
      ipcRenderer.invoke('profile:updateMcpServer', serverName, serverConfig),
    deleteMcpServer: (serverName: string) =>
      ipcRenderer.invoke('profile:deleteMcpServer', serverName),
    connectMcpServer: (serverName: string) =>
      ipcRenderer.invoke('profile:connectMcpServer', serverName),
    reconnectMcpServer: (serverName: string) =>
      ipcRenderer.invoke('profile:reconnectMcpServer', serverName),
    disconnectMcpServer: (serverName: string) =>
      ipcRenderer.invoke('profile:disconnectMcpServer', serverName),

    // ChatConfig operations through ProfileCacheManager
    addChatConfig: (chatConfig: any) =>
      ipcRenderer.invoke('profile:addChatConfig', chatConfig),
    duplicateChatConfig: (sourceChatId: string, newAgentName: string) =>
      ipcRenderer.invoke('profile:duplicateChatConfig', sourceChatId, newAgentName),
    updateChatConfig: (chatId: string, chatConfig: any) =>
      ipcRenderer.invoke('profile:updateChatConfig', chatId, chatConfig),
    deleteChatConfig: (chatId: string) =>
      ipcRenderer.invoke('profile:deleteChatConfig', chatId),
    getChatConfig: (chatId: string) =>
      ipcRenderer.invoke('profile:getChatConfig', chatId),
    getAllChatConfigs: () => ipcRenderer.invoke('profile:getAllChatConfigs'),
    updateChatAgent: (chatId: string, agentUpdates: any) =>
      ipcRenderer.invoke('profile:updateChatAgent', chatId, agentUpdates),

    // Archive Agent operations
    archiveChatConfig: (chatId: string) =>
      ipcRenderer.invoke('profile:archiveChatConfig', chatId),
    unarchiveChatConfig: (chatId: string) =>
      ipcRenderer.invoke('profile:unarchiveChatConfig', chatId),
    getArchivedAgents: () =>
      ipcRenderer.invoke('profile:getArchivedAgents'),

    // ChatSession operations through ProfileCacheManager
    saveChatSession: (
      alias: string,
      chatId: string,
      chatSessionFile: any,
    ) =>
      ipcRenderer.invoke(
        'profile:saveChatSession',
        alias,
        chatId,
        chatSessionFile,
      ),
    deleteChatSession: (alias: string, chatId: string, sessionId: string) =>
      ipcRenderer.invoke('profile:deleteChatSession', alias, chatId, sessionId),
    getChatSessionFile: (alias: string, chatId: string, sessionId: string) =>
      ipcRenderer.invoke(
        'profile:getChatSessionFile',
        alias,
        chatId,
        sessionId,
      ),
    renameChatSession: (alias: string, chatId: string, sessionId: string, newTitle: string) =>
      ipcRenderer.invoke(
        'profile:renameChatSession',
        alias,
        chatId,
        sessionId,
        newTitle,
      ),
    setChatSessionStarred: (alias: string, chatId: string, sessionId: string, starred: boolean) =>
      ipcRenderer.invoke(
        'profile:setChatSessionStarred',
        alias,
        chatId,
        sessionId,
        starred,
      ),
    getChatSessions: (alias: string, chatId: string, minCount?: number) =>
      ipcRenderer.invoke('profile:getChatSessions', alias, chatId, minCount),
    getMoreChatSessions: (
      alias: string,
      chatId: string,
      fromMonthIndex: number,
    ) =>
      ipcRenderer.invoke(
        'profile:getMoreChatSessions',
        alias,
        chatId,
        fromMonthIndex,
      ),
    getChatSession: (chatId: string, sessionId: string) =>
      ipcRenderer.invoke('profile:getChatSession', chatId, sessionId),
    createChatSession: (chatId: string, title?: string) =>
      ipcRenderer.invoke('profile:createChatSession', chatId, title),

    // Primary Agent operations
    setPrimaryAgent: (agentName: string) =>
      ipcRenderer.invoke('profile:setPrimaryAgent', agentName),

    // FRE (First Run Experience) operations
    updateFreDone: (alias: string, freDone: boolean) =>
      ipcRenderer.invoke('profile:updateFreDone', alias, freDone),
  },
  signin: {
    getValidUsersForSignin: () =>
      ipcRenderer.invoke('signin:getValidUsersForSignin'),
    clearTokens: (alias: string) =>
      ipcRenderer.invoke('signin:clearTokens', alias),
    deleteAuthJson: (alias: string) =>
      ipcRenderer.invoke('signin:deleteAuthJson', alias),
    updateAuthJson: (alias: string, authData: any) =>
      ipcRenderer.invoke('signin:updateAuthJson', alias, authData),
    getProfilesWithGhcAuth: () =>
      ipcRenderer.invoke('signin:getProfilesWithGhcAuth'),
  },
  auth: {
    // New naming (AuthData architecture) - primary APIs
    getLocalActiveAuths: () =>
      ipcRenderer.invoke('auth:getLocalActiveSessions'),
    setCurrentAuth: (authData: any) =>
      ipcRenderer.invoke('auth:setCurrentSession', authData),
    getCurrentAuth: () => ipcRenderer.invoke('auth:getCurrentSession'),
    destroyCurrentAuth: () => ipcRenderer.invoke('auth:destroyCurrentSession'),
    getCopilotToken: () => ipcRenderer.invoke('auth:getAccessToken'),
    getGitHubToken: () => ipcRenderer.invoke('auth:getAccessToken'), // Uses the same token endpoint
    refreshCopilotToken: () =>
      ipcRenderer.invoke('auth:refreshCurrentSessionToken'),
    onAuthChanged: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('auth:authChanged', listener);
      return () => ipcRenderer.removeListener('auth:authChanged', listener);
    },

    // Legacy naming (backward compatible) - mapped to same IPC handlers
    getLocalActiveSessions: () =>
      ipcRenderer.invoke('auth:getLocalActiveSessions'),
    setCurrentSession: (session: any) =>
      ipcRenderer.invoke('auth:setCurrentSession', session),
    getCurrentSession: () => ipcRenderer.invoke('auth:getCurrentSession'),
    destroyCurrentSession: () =>
      ipcRenderer.invoke('auth:destroyCurrentSession'),
    getAccessToken: () => ipcRenderer.invoke('auth:getAccessToken'),
    refreshCurrentSessionToken: () =>
      ipcRenderer.invoke('auth:refreshCurrentSessionToken'),
    onSessionChanged: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('auth:sessionChanged', listener);
      return () => ipcRenderer.removeListener('auth:sessionChanged', listener);
    },

    // Token monitoring
    // Note: startTokenMonitoring has been removed - Token monitoring is now automatically started by setCurrentAuth()
    stopTokenMonitoring: () => ipcRenderer.invoke('auth:stopTokenMonitoring'),
    getMonitoringStatus: () => ipcRenderer.invoke('auth:getMonitoringStatus'),
    manualTokenCheck: () => ipcRenderer.invoke('auth:manualTokenCheck'),
    onTokenMonitor: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('auth:tokenMonitor', listener);
      return () => ipcRenderer.removeListener('auth:tokenMonitor', listener);
    },

    // GitHub Copilot OAuth Device Flow - complete flow
    startGhcDeviceFlow: () => ipcRenderer.invoke('auth:startGhcDeviceFlow'),

    // Unified sign-out API - coordinate cleanup of all components
    signOut: () => ipcRenderer.invoke('auth:signOut'),

    // Device Flow event listeners
    onDeviceCodeGenerated: (callback: (deviceCode: any) => void) => {
      ipcRenderer.on('auth:deviceCodeGenerated', (event, deviceCode) =>
        callback(deviceCode),
      );
    },
    onDeviceFlowSuccess: (callback: (data: any) => void) => {
      ipcRenderer.on('auth:deviceFlowSuccess', (event, data) => callback(data));
    },
    onDeviceFlowError: (callback: (data: any) => void) => {
      ipcRenderer.on('auth:deviceFlowError', (event, data) => callback(data));
    },
    removeDeviceFlowListeners: () => {
      ipcRenderer.removeAllListeners('auth:deviceCodeGenerated');
      ipcRenderer.removeAllListeners('auth:deviceFlowSuccess');
      ipcRenderer.removeAllListeners('auth:deviceFlowError');
    },
  },
  llm: {
    improveSystemPrompt: (userInputPrompt: string) =>
      ipcRenderer.invoke('llm:improveSystemPrompt', userInputPrompt),
    formatMcpConfig: (userInputMcpConfig: string) =>
      ipcRenderer.invoke('llm:formatMcpConfig', userInputMcpConfig),
    generateChatTitle: (userMessage: string) =>
      ipcRenderer.invoke('llm:generateChatTitle', userMessage),
    generateFileName: (content: string) =>
      ipcRenderer.invoke('llm:generateFileName', content),
    generateDocumentSummary: (fileName: string, content: string, truncated?: boolean) =>
      ipcRenderer.invoke('llm:generateDocumentSummary', fileName, content, truncated ?? false),
    embedText: (text: string) => ipcRenderer.invoke('llm:embedText', text),
    embedBatch: (texts: string[]) =>
      ipcRenderer.invoke('llm:embedBatch', texts),
  },
  models: {
    getAllModels: () => ipcRenderer.invoke('models:getAllModels'),
    getAllOpenKosmosUsedModels: () =>
      ipcRenderer.invoke('models:getAllOpenKosmosUsedModels'),
    getModelById: (modelId: string) =>
      ipcRenderer.invoke('models:getModelById', modelId),
    getModelCapabilities: (modelId: string) =>
      ipcRenderer.invoke('models:getModelCapabilities', modelId),
    validateModelId: (modelId: string) =>
      ipcRenderer.invoke('models:validateModelId', modelId),
    getDefaultModel: () => ipcRenderer.invoke('models:getDefaultModel'),
    isReasoningModel: (modelId: string) =>
      ipcRenderer.invoke('models:isReasoningModel', modelId),
    onModelsUpdated: (callback: (data: { count: number; timestamp: number }) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('models:updated', listener);
      return () => ipcRenderer.removeListener('models:updated', listener);
    },
  },
  featureFlags: {
    getAllFlags: () => ipcRenderer.invoke('featureFlags:getAllFlags'),
    isEnabled: (flagName: string) =>
      ipcRenderer.invoke('featureFlags:isEnabled', flagName),
  },
  mcp: {
    getServerStatus: () => ipcRenderer.invoke('mcp:getServerStatus'),
    connectServer: (serverName: string) =>
      ipcRenderer.invoke('mcp:connectServer', serverName),
    disconnectServer: (serverName: string) =>
      ipcRenderer.invoke('mcp:disconnectServer', serverName),
    reconnectServer: (serverName: string) =>
      ipcRenderer.invoke('mcp:reconnectServer', serverName),
    addServer: (serverName: string, mcpServer: any) =>
      ipcRenderer.invoke('mcp:addServer', serverName, mcpServer),
    updateServer: (serverName: string, mcpServer: any) =>
      ipcRenderer.invoke('mcp:updateServer', serverName, mcpServer),
    deleteServer: (serverName: string) =>
      ipcRenderer.invoke('mcp:deleteServer', serverName),
    getAllTools: () => ipcRenderer.invoke('mcp:getAllTools'),
    executeTool: (toolName: string, toolArgs: any) =>
      ipcRenderer.invoke('mcp:executeTool', toolName, toolArgs),
    onServerStatesUpdated: (callback: (serverStates: any[]) => void) => {
      const listener = (event: any, serverStates: any) =>
        callback(serverStates);
      ipcRenderer.on('mcp:serverStatesUpdated', listener);
      return () =>
        ipcRenderer.removeListener('mcp:serverStatesUpdated', listener);
    },

    // Log management APIs implementation
    getServerLogs: (serverName: string, filter?: any) =>
      ipcRenderer.invoke('mcp:getServerLogs', serverName, filter),
    getAllServerLogStats: () => ipcRenderer.invoke('mcp:getAllServerLogStats'),
    clearServerLogs: (serverName: string) =>
      ipcRenderer.invoke('mcp:clearServerLogs', serverName),
    setServerLoggingEnabled: (serverName: string, enabled: boolean) =>
      ipcRenderer.invoke('mcp:setServerLoggingEnabled', serverName, enabled),
    openServerLogFile: (serverName: string) =>
      ipcRenderer.invoke('mcp:openServerLogFile', serverName),
    onServerLogUpdate: (
      callback: (data: { serverName: string; entry: any }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('mcp:serverLogUpdate', listener);
      return () => ipcRenderer.removeListener('mcp:serverLogUpdate', listener);
    },

    // Dev-facing OAuth reset (see preload type declaration above for usage notes)
    resetOAuth: (serverName: string, scope: 'tokens' | 'all' = 'tokens') =>
      ipcRenderer.invoke('mcp:resetOAuth', serverName, scope),
  },
  // Runtime Environment Management
  runtime: {
    setMode: (mode: 'system' | 'internal') => ipcRenderer.invoke('runtime:set-mode', mode),
    install: (tool: 'bun' | 'uv', version: string) => ipcRenderer.invoke('runtime:install-component', tool, version),
    checkStatus: () => ipcRenderer.invoke('runtime:check-status'),
    checkGitVersion: () => ipcRenderer.invoke('runtime:check-git-version'),
    listPythonVersions: () => ipcRenderer.invoke('runtime:list-python-versions'),
    /** Fast synchronous Python version scan - typically < 50ms, use for FRE */
    listPythonVersionsFast: () => ipcRenderer.invoke('runtime:list-python-versions-fast'),
    installPythonVersion: (version: string) => ipcRenderer.invoke('runtime:install-python-version', version),
    uninstallPythonVersion: (version: string) => ipcRenderer.invoke('runtime:uninstall-python-version', version),
    setPinnedPythonVersion: (version: string | null) => ipcRenderer.invoke('runtime:set-pinned-python-version', version),
    cleanUvCache: () => ipcRenderer.invoke('runtime:clean-uv-cache'),
  },
  openkosmos: {
    replacePlaceholders: (envObj: Record<string, string>) =>
      ipcRenderer.invoke('openkosmos:replacePlaceholders', envObj),
    parseUserInputPlaceholders: (config: any) =>
      ipcRenderer.invoke('openkosmos:parseUserInputPlaceholders', config),
  },
  skillLibrary: {
    validateSkill: (skillName: string) =>
      ipcRenderer.invoke('skillLibrary:validateSkill', skillName),
    addSkillFromDevice: (selectedPath?: string, options?: { chatId?: string; applyToCurrentAgent?: boolean; agentName?: string; requestSource?: string; selectionMode?: 'artifact' | 'folder' }) =>
      ipcRenderer.invoke('skillLibrary:addSkillFromDevice', selectedPath, options),
    installSkillFromFilePath: (filePath: string, options?: { chatId?: string; applyToCurrentAgent?: boolean; agentName?: string; requestSource?: string }) =>
      ipcRenderer.invoke('skillLibrary:installSkillFromFilePath', filePath, options),
    updateSkillFromDevice: (skillName: string) =>
      ipcRenderer.invoke('skillLibrary:updateSkillFromDevice', skillName),
    applySkillToAgents: (skillName: string, targets: Array<{ chatId: string; agentName: string }>) =>
      ipcRenderer.invoke('skillLibrary:applySkillToAgents', skillName, targets),
    showOverwriteConfirmDialog: (skillName: string) =>
      ipcRenderer.invoke('skillLibrary:showOverwriteConfirmDialog', skillName),
  },
  builtinTools: {
    execute: (toolName: string, args: any) =>
      ipcRenderer.invoke('builtinTools:execute', toolName, args),
    getAllTools: () => ipcRenderer.invoke('builtinTools:getAllTools'),
    isBuiltinTool: (toolName: string) =>
      ipcRenderer.invoke('builtinTools:isBuiltinTool', toolName),
  },
  skills: {
    getSkillMarkdown: (skillName: string) =>
      ipcRenderer.invoke('skills:getSkillMarkdown', skillName),
    getSkillDirectoryContents: (skillName: string, relativePath: string = '') =>
      ipcRenderer.invoke(
        'skills:getSkillDirectoryContents',
        skillName,
        relativePath,
      ),
    getSkillFileContent: (skillName: string, relativePath: string) =>
      ipcRenderer.invoke('skills:getSkillFileContent', skillName, relativePath),
    deleteSkill: (skillName: string) =>
      ipcRenderer.invoke('skills:deleteSkill', skillName),
    openSkillFolder: (skillName: string) =>
      ipcRenderer.invoke('skills:openSkillFolder', skillName),
  },
  plugin: {
    invoke: invokePlugin,
  },
  subAgent: {
    getAll: () => ipcRenderer.invoke('subAgent:getAll'),
    add: (config: any) => ipcRenderer.invoke('subAgent:add', config),
    update: (name: string, config: any) =>
      ipcRenderer.invoke('subAgent:update', name, config),
    delete: (name: string) => ipcRenderer.invoke('subAgent:delete', name),
    importFromFile: (filePath: string) =>
      ipcRenderer.invoke('subAgent:importFromFile', filePath),
    exportAsClaudeCode: (name: string) =>
      ipcRenderer.invoke('subAgent:exportAsClaudeCode', name),
    openInExplorer: (name: string) =>
      ipcRenderer.invoke('subAgent:openInExplorer', name),
    syncFromDisk: () => ipcRenderer.invoke('subAgent:syncFromDisk'),
    onStateUpdate: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state);
      ipcRenderer.on('subAgent:stateUpdate', listener);
      return () =>
        ipcRenderer.removeListener('subAgent:stateUpdate', listener);
    },
  },
  subAgentTask: {
    listForSession: (parentSessionId: string) => ipcRenderer.invoke('subAgentTask:listForSession', parentSessionId),
    open: (taskId: string) => ipcRenderer.invoke('subAgentTask:open', taskId),
    close: (taskId: string) => ipcRenderer.invoke('subAgentTask:close', taskId),
    resolveByCorrelationId: (correlationId: string) => ipcRenderer.invoke('subAgentTask:resolveByCorrelationId', correlationId),
    onStreamingChunk: (callback: (chunk: any) => void) => {
      const listener = (_event: any, chunk: any) => callback(chunk);
      ipcRenderer.on('subAgentTask:streamingChunk', listener);
      return () => ipcRenderer.removeListener('subAgentTask:streamingChunk', listener);
    },
    onTaskCreated: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('subAgentTaskStore:taskCreated', listener);
      return () => ipcRenderer.removeListener('subAgentTaskStore:taskCreated', listener);
    },
    onTaskUpdated: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('subAgentTaskStore:taskUpdated', listener);
      return () => ipcRenderer.removeListener('subAgentTaskStore:taskUpdated', listener);
    },
  },
  agentChat: {
    initialize: (alias: string) =>
      ipcRenderer.invoke('agentChat:initialize', alias),
    getCurrentInstance: () =>
      ipcRenderer.invoke('agentChat:getCurrentInstance'),
    getChatHistory: () => ipcRenderer.invoke('agentChat:getChatHistory'),
    getDisplayMessages: () =>
      ipcRenderer.invoke('agentChat:getDisplayMessages'),
    startNewChatFor: (
      chatId: string,
      _options?: {
        sayHiMessageConfig?: {
          markdownContent: string;
          initialDelay?: number;
          retryDelay?: number;
          maxRetries?: number;
        };
      },
    ) => ipcRenderer.invoke('agentChat:startNewChatFor', chatId),
    streamMessage: (message: UserMessage, targetChatSessionId?: string) =>
      ipcRenderer.invoke('agentChat:streamMessage', message, targetChatSessionId),
    // 🔥 Retry the last failed conversation
    retryChat: (chatSessionId: string) =>
      ipcRenderer.invoke('agentChat:retryChat', chatSessionId),
    canEditUserMessage: (chatSessionId: string, messageId: string) =>
      ipcRenderer.invoke('agentChat:canEditUserMessage', chatSessionId, messageId),
    editUserMessage: (chatSessionId: string, messageId: string, updatedMessage: any) =>
      ipcRenderer.invoke('agentChat:editUserMessage', chatSessionId, messageId, updatedMessage),
    // 🔥 New: IPC call to cancel chat operation
    cancelChat: (chatId: string) =>
      ipcRenderer.invoke('agentChat:cancelChat', chatId),
    syncChatHistory: (messages: any[]) =>
      ipcRenderer.invoke('agentChat:syncChatHistory', messages),
    getCurrentChatId: () => ipcRenderer.invoke('agentChat:getCurrentChatId'),
    refreshCurrentInstance: () =>
      ipcRenderer.invoke('agentChat:refreshCurrentInstance'),
    switchToChatSession: (chatId: string, chatSessionId: string) =>
      ipcRenderer.invoke(
        'agentChat:switchToChatSession',
        chatId,
        chatSessionId,
      ),
    // 🔥 New: IPC call to cancel specified ChatSession operation
    cancelChatSession: (chatSessionId: string) =>
      ipcRenderer.invoke('agentChat:cancelChatSession', chatSessionId),
    cancelActiveToolExecution: (chatSessionId: string) =>
      ipcRenderer.invoke('agentChat:cancelActiveToolExecution', chatSessionId),
    getCurrentChatSession: () =>
      ipcRenderer.invoke('agentChat:getCurrentChatSession'),
    // 🔥 New: get current ChatSession status (frontend-initiated call)
    getChatStatusInfo: () => ipcRenderer.invoke('agentChat:getChatStatusInfo'),
    // 🔥 New: get current Context Token usage (frontend-initiated call)
    getCurrentContextTokenUsage: () =>
      ipcRenderer.invoke('agentChat:getCurrentContextTokenUsage'),
    onStreamingMessage: (callback: (message: any) => void) => {
      const listener = (event: any, message: any) => callback(message);
      ipcRenderer.on('agentChat:streamingMessage', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:streamingMessage', listener);
    },
    onToolUse: (callback: (toolName: string) => void) => {
      const listener = (event: any, toolName: string) => callback(toolName);
      ipcRenderer.on('agentChat:toolUse', listener);
      return () => ipcRenderer.removeListener('agentChat:toolUse', listener);
    },
    onToolResult: (callback: (result: any) => void) => {
      const listener = (event: any, result: any) => callback(result);
      ipcRenderer.on('agentChat:toolResult', listener);
      return () => ipcRenderer.removeListener('agentChat:toolResult', listener);
    },
    onToolMessageAdded: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:toolMessageAdded', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:toolMessageAdded', listener);
    },
    onContextChange: (callback: (stats: any) => void) => {
      const listener = (event: any, stats: any) => callback(stats);
      ipcRenderer.on('agentChat:contextChange', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:contextChange', listener);
    },
    onInteractionRequest: (callback: (request: any) => void) => {
      const listener = (event: any, request: any) => callback(request);
      ipcRenderer.on('agentChat:interactionRequest', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:interactionRequest', listener);
    },
    sendInteractionResponse: (response: any) => ipcRenderer.invoke('agentChat:sendInteractionResponse', response),
    onInteractionProcessed: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:interactionProcessed', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:interactionProcessed', listener);
    },
    onChatStatusChanged: (
      callback: (data: {
        chatId: string;
        chatSessionId: string;
        chatStatus: string;
        agentName?: string;
        timestamp?: string;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:chatStatusChanged', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:chatStatusChanged', listener);
    },
    onStreamingChunk: (callback: (chunk: any) => void) => {
      const listener = (event: any, chunk: any) => callback(chunk);
      ipcRenderer.on('agentChat:streamingChunk', listener);
      return () =>
        ipcRenderer.removeListener('agentChat:streamingChunk', listener);
    },
    // 🔥 New: IPC event implementation required by agentChatSessionCacheManager
    onCurrentChatSessionIdChanged: (
      callback: (data: {
        chatId: string | null;
        chatSessionId: string | null;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:currentChatSessionIdChanged', listener);
      return () =>
        ipcRenderer.removeListener(
          'agentChat:currentChatSessionIdChanged',
          listener,
        );
    },
    onChatSessionCacheCreated: (
      callback: (data: {
        chatSessionId: string;
        chatId: string;
        initialData?: any;
      }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:chatSessionCacheCreated', listener);
      return () =>
        ipcRenderer.removeListener(
          'agentChat:chatSessionCacheCreated',
          listener,
        );
    },
    onChatSessionCacheDestroyed: (
      callback: (data: { chatSessionId: string }) => void,
    ) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('agentChat:chatSessionCacheDestroyed', listener);
      return () =>
        ipcRenderer.removeListener(
          'agentChat:chatSessionCacheDestroyed',
          listener,
        );
    },
    // 🔥 New: clean up AgentChat instance when deleting ChatSession
    removeAgentChatInstance: (chatSessionId: string) =>
      ipcRenderer.invoke('agentChat:removeAgentChatInstance', chatSessionId),
    // 🔥 New: Fork ChatSession - duplicate ChatSession and switch to the new one
    forkChatSession: (chatId: string, sourceChatSessionId: string) =>
      ipcRenderer.invoke(
        'agentChat:forkChatSession',
        chatId,
        sourceChatSessionId,
      ),
    importChatSession: (chatId: string) =>
      ipcRenderer.invoke('agentChat:importChatSession', chatId),
    // 🔥 New: Replace file path references in current ChatSession (used when moving files to Knowledge Base)
    replaceFilePathInSession: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('agentChat:replaceFilePathInSession', oldPath, newPath),
  },
  chatSessionOps: {
    readChatSession: (sessionId: string) =>
      ipcRenderer.invoke('chatSessionOps:readChatSession', sessionId),
    writeChatSession: (sessionData: any) =>
      ipcRenderer.invoke('chatSessionOps:writeChatSession', sessionData),
    deleteChatSession: (sessionId: string) =>
      ipcRenderer.invoke('chatSessionOps:deleteChatSession', sessionId),
    listChatSessions: () =>
      ipcRenderer.invoke('chatSessionOps:listChatSessions'),
    getChatSessionMetadata: (sessionId: string) =>
      ipcRenderer.invoke('chatSessionOps:getChatSessionMetadata', sessionId),
    // 🔥 New: download ChatSession to Downloads directory
    downloadChatSession: (alias: string, chatId: string, sessionId: string, title: string) =>
      ipcRenderer.invoke('chatSession:downloadChatSession', alias, chatId, sessionId, title),
    getChatSessionFilePath: (alias: string, chatId: string, sessionId: string) =>
      ipcRenderer.invoke('chatSession:getFilePath', alias, chatId, sessionId),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onWindowStateChanged: (callback: (state: string) => void) => {
      const listener = (_event: any, state: string) => callback(state);
      ipcRenderer.on('window:stateChanged', listener);
      return () => ipcRenderer.removeListener('window:stateChanged', listener);
    },
    showAppMenu: (x: number, y: number) =>
      ipcRenderer.invoke('window:showAppMenu', x, y), // 🔥 New
    setSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setSize', width, height),
    getSize: () => ipcRenderer.invoke('window:getSize'),
    setAlwaysOnTop: (flag: boolean) =>
      ipcRenderer.invoke('window:setAlwaysOnTop', flag),
    isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
    setMinSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setMinSize', width, height),
    setMaxSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setMaxSize', width, height),
    getMinSize: () => ipcRenderer.invoke('window:getMinSize'),
    getMaxSize: () => ipcRenderer.invoke('window:getMaxSize'),
    zoomIn: () => ipcRenderer.invoke('window:zoomIn'),
    zoomOut: () => ipcRenderer.invoke('window:zoomOut'),
    resetZoom: () => ipcRenderer.invoke('window:resetZoom'),
    getZoomLevel: () => ipcRenderer.invoke('window:getZoomLevel'),
    onZoomChanged: (callback: (level: number) => void) => {
      const listener = (_event: any, level: number) => callback(level);
      ipcRenderer.on('window:zoomChanged', listener);
      return () => ipcRenderer.removeListener('window:zoomChanged', listener);
    },
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onFullScreenChanged: (callback: (isFullScreen: boolean) => void) => {
      const listener = (_event: any, isFullScreen: boolean) => callback(isFullScreen);
      ipcRenderer.on('window:fullScreenChanged', listener);
      return () => ipcRenderer.removeListener('window:fullScreenChanged', listener);
    },
  },
  logger: {
    manualFlush: () => ipcRenderer.invoke('logger:manualFlush'),
    sendLog: (log: any) => ipcRenderer.send('logger:rendererLog', log),
  },
  folder: {
    openLogs: () => ipcRenderer.invoke('folder:openLogs'),
    openProfile: (alias: string) =>
      ipcRenderer.invoke('folder:openProfile', alias),
  },
  fs: {
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    listDir: (dirPath: string) => ipcRenderer.invoke('fs:listDir', dirPath),
    access: (filePath: string) => ipcRenderer.invoke('fs:access', filePath),
    readFile: (filePath: string, encoding?: string) =>
      ipcRenderer.invoke('fs:readFile', filePath, encoding),
    writeFile: (
      filePath: string,
      content: string,
      encoding?: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => ipcRenderer.invoke('fs:writeFile', filePath, content, encoding, options),
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    expandPath: (path: string) => ipcRenderer.invoke('fs:expandPath', path),
    selectFile: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => ipcRenderer.invoke('fs:selectFile', options),
    // New: API implementation for getting complete file metadata
    getFileMetadata: (filePath: string) =>
      ipcRenderer.invoke('fs:getFileMetadata', filePath),
    // New: API implementation for selecting multiple files
    selectFiles: (options?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      allowMultiple?: boolean;
    }) => ipcRenderer.invoke('fs:selectFiles', options),
    // New: delete files or directories (supports multiple paths, recursive directory deletion)
    deletePaths: (paths: string[]) => ipcRenderer.invoke('fs:deletePaths', paths),
    // New: download file from URL to local path
    downloadFile: (url: string, destPath: string) =>
      ipcRenderer.invoke('fs:downloadFile', url, destPath),
    // 🔥 New: get full path of dragged file
    // Use Electron webUtils.getPathForFile() API (Electron 26+)
    // This is the official solution for the missing path property on dragged files under contextIsolation: true
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  debug: {
    openWindow: () => ipcRenderer.invoke('debug:openWindow'),
  },
  update: {
    checkForUpdates: (silent?: boolean) =>
      ipcRenderer.invoke('update:checkForUpdates', silent),
    downloadUpdate: (downloadUrl?: string) =>
      ipcRenderer.invoke('update:downloadUpdate', downloadUrl),
    quitAndInstall: (filePath?: string) => {
      try {
        // Synchronous call, no await needed since the app will exit immediately
        const result = ipcRenderer.invoke('update:quitAndInstall', filePath);
        return result;
      } catch (error) {
        throw error;
      }
    },
    getVersion: () => ipcRenderer.invoke('update:getVersion'),
    skipVersion: (version: string) =>
      ipcRenderer.invoke('update:skipVersion', version),
    getPreferences: () => ipcRenderer.invoke('update:getPreferences'),
    updatePreferences: (preferences: any) =>
      ipcRenderer.invoke('update:updatePreferences', preferences),

    onUpdateEvent: (channel: string, callback: (data?: any) => void) => {
      const fullChannel = `update:${channel}`;
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on(fullChannel, listener);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(fullChannel, listener);
      };
    },
  },
  startupUpdate: {
    checkAndInstallUpdates: () =>
      ipcRenderer.invoke('startup:checkAndInstallUpdates'),
    onProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('startup:updateProgress', listener);
      return () => {
        ipcRenderer.removeListener('startup:updateProgress', listener);
      };
    },
  },
  chroma: {
    startServer: (userAlias: string) =>
      ipcRenderer.invoke('chroma:startServer', userAlias),
    stopServer: () => ipcRenderer.invoke('chroma:stopServer'),
    getServerStatus: () => ipcRenderer.invoke('chroma:getServerStatus'),
    restartServer: (userAlias: string) =>
      ipcRenderer.invoke('chroma:restartServer', userAlias),
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke('workspace:selectFolder'),
    getFileTree: (
      workspacePath: string,
      options?: { maxDepth?: number; ignorePatterns?: string[] },
    ) => ipcRenderer.invoke('workspace:getFileTree', workspacePath, options),
    clearFileTreeCache: (workspacePath?: string) =>
      ipcRenderer.invoke('workspace:clearFileTreeCache', workspacePath),
    getDirectoryChildren: (dirPath: string, options?: { ignorePatterns?: string[] }) =>
      ipcRenderer.invoke('workspace:getDirectoryChildren', dirPath, options),
    copyPath: (
      sourcePath: string,
      destPath: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => ipcRenderer.invoke('workspace:copyPath', sourcePath, destPath, options),
    copyPaths: (
      sourcePaths: string[],
      destPath: string,
      options?: {
        conflictResolution?: 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';
      },
    ) => ipcRenderer.invoke('workspace:copyPaths', sourcePaths, destPath, options),
    movePath: (sourcePath: string, destPath: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke('workspace:movePath', sourcePath, destPath, options),
    startWatch: (
      workspacePath: string,
      options?: { excludes?: string[]; includes?: string[] },
    ) => ipcRenderer.invoke('workspace:startWatch', workspacePath, options),
    stopWatch: () => ipcRenderer.invoke('workspace:stopWatch'),
    getWatcherStats: () => ipcRenderer.invoke('workspace:getWatcherStats'),
    searchFiles: (query: {
      folder?: string;
      pattern?: string;
      maxResults?: number;
      fuzzy?: boolean;
      searchTarget?: 'files' | 'folders' | 'both';
    }) => ipcRenderer.invoke('workspace:searchFiles', query),
    onFileChanged: (callback: (changes: any[]) => void) => {
      const listener = (event: any, changes: any[]) => callback(changes);
      ipcRenderer.on('workspace:fileChanged', listener);
      return () =>
        ipcRenderer.removeListener('workspace:fileChanged', listener);
    },
    onWatchError: (callback: (error: any) => void) => {
      const listener = (event: any, error: any) => callback(error);
      ipcRenderer.on('workspace:watchError', listener);
      return () => ipcRenderer.removeListener('workspace:watchError', listener);
    },
    openPath: (targetPath: string) =>
      ipcRenderer.invoke('workspace:openPath', targetPath),
    showInFolder: (targetPath: string) =>
      ipcRenderer.invoke('workspace:showInFolder', targetPath),
    getDefaultWorkspacePath: (alias: string, chatId: string) =>
      ipcRenderer.invoke('workspace:getDefaultWorkspacePath', alias, chatId),
  },

  // Quick Start Image Cache management
  quickStartImageCache: {
    getOrCache: (agentName: string, imageUrl: string) =>
      ipcRenderer.invoke('quickStartImageCache:getOrCache', agentName, imageUrl),
    clearAgent: (agentName: string) =>
      ipcRenderer.invoke('quickStartImageCache:clearAgent', agentName),
    clearAll: () =>
      ipcRenderer.invoke('quickStartImageCache:clearAll'),
  },

  // Screenshot functionality
  screenshot: {
    invoke: invokeScreenshot,
  },

  // External Agent functionality
  externalAgent: {
    invoke: invokeExternalAgent,
    on: ipcRenderer.on.bind(ipcRenderer),
    off: ipcRenderer.off.bind(ipcRenderer),
  },

  // Whisper STT functionality (Voice Input)
  whisper: {
    getAllModelStatus: () => ipcRenderer.invoke('whisper:getAllModelStatus'),
    getModelStatus: (size: string) => ipcRenderer.invoke('whisper:getModelStatus', size),
    getAllModelInfo: () => ipcRenderer.invoke('whisper:getAllModelInfo'),
    downloadModel: (size: string) => ipcRenderer.invoke('whisper:downloadModel', size),
    cancelDownload: (size: string) => ipcRenderer.invoke('whisper:cancelDownload', size),
    deleteModel: (size: string) => ipcRenderer.invoke('whisper:deleteModel', size),
    getModelPath: (size: string) => ipcRenderer.invoke('whisper:getModelPath', size),
    isDownloading: () => ipcRenderer.invoke('whisper:isDownloading'),
    // Transcription API
    transcribe: (pcmData: Float32Array, modelSize: string, options?: {
      language?: string;
      useGPU?: boolean;
      enableVAD?: boolean;
      threads?: number;
      translate?: boolean;
    }) => ipcRenderer.invoke('whisper:transcribe', {
      pcmData: Array.from(pcmData), // Convert Float32Array to regular array for IPC
      modelSize,
      options,
    }),
    isAvailable: () => ipcRenderer.invoke('whisper:isAvailable'),
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (event: any, progress: any) => callback(progress);
      ipcRenderer.on('whisper:downloadProgress', listener);
      return () => ipcRenderer.removeListener('whisper:downloadProgress', listener);
    },
    onDownloadComplete: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('whisper:downloadComplete', listener);
      return () => ipcRenderer.removeListener('whisper:downloadComplete', listener);
    },
    onDownloadError: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('whisper:downloadError', listener);
      return () => ipcRenderer.removeListener('whisper:downloadError', listener);
    },
    onDownloadCancelled: (callback: (data: any) => void) => {
      const listener = (event: any, data: any) => callback(data);
      ipcRenderer.on('whisper:downloadCancelled', listener);
      return () => ipcRenderer.removeListener('whisper:downloadCancelled', listener);
    },
    // Streaming transcription APIs
    startStreaming: (modelSize: string, options?: {
      language?: string;
      useGPU?: boolean;
      threads?: number;
      translate?: boolean;
      vadThreshold?: number;
      silenceDuration?: number;
      minSpeechDuration?: number;
    }) => ipcRenderer.invoke('whisper:startStreaming', { modelSize, options }),
    processChunk: (sessionId: string, pcmData: Float32Array) => ipcRenderer.invoke('whisper:processChunk', {
      sessionId,
      pcmData: Array.from(pcmData), // Convert Float32Array to regular array for IPC
    }),
    stopStreaming: (sessionId: string) => ipcRenderer.invoke('whisper:stopStreaming', sessionId),
    cancelStreaming: (sessionId: string) => ipcRenderer.invoke('whisper:cancelStreaming', sessionId),
    isStreamingActive: (sessionId: string) => ipcRenderer.invoke('whisper:isStreamingActive', sessionId),
    onStreamingUpdate: (callback: (update: {
      sessionId: string;
      type: 'interim' | 'final' | 'error' | 'started' | 'stopped';
      text?: string;
      segments?: Array<{ start: string; end: string; text: string }>;
      error?: string;
      duration?: number;
    }) => void) => {
      const listener = (event: any, update: any) => callback(update);
      ipcRenderer.on('whisper:streamingUpdate', listener);
      return () => ipcRenderer.removeListener('whisper:streamingUpdate', listener);
    },
  },

  // Voice Input Settings
  voiceInput: {
    getSettings: () => ipcRenderer.invoke('voiceInput:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('voiceInput:updateSettings', settings),
  },

  // Native Module on-demand download management
  // Manage on-demand downloadable large native modules (whisper-addon)
  nativeModule: {
    getStatus: (moduleKey: string) => ipcRenderer.invoke('native-module:getStatus', moduleKey),
    ensureDownloaded: (moduleKey: string) => ipcRenderer.invoke('native-module:ensureDownloaded', moduleKey),
    cancelDownload: (moduleKey: string) => ipcRenderer.invoke('native-module:cancelDownload', moduleKey),
    deleteModule: (moduleKey: string) => ipcRenderer.invoke('native-module:delete', moduleKey),
    // Push events from main process
    onDownloadStarted: (callback: (data: { packageName: string; url: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('native-module:downloadStarted', listener);
      return () => ipcRenderer.removeListener('native-module:downloadStarted', listener);
    },
    onDownloadProgress: (callback: (data: { packageName: string; bytesDownloaded: number; bytesTotal: number; percent: number }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('native-module:downloadProgress', listener);
      return () => ipcRenderer.removeListener('native-module:downloadProgress', listener);
    },
    onDownloadComplete: (callback: (data: { packageName: string; localPath: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('native-module:downloadComplete', listener);
      return () => ipcRenderer.removeListener('native-module:downloadComplete', listener);
    },
    onDownloadCancelled: (callback: (data: { packageName: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('native-module:downloadCancelled', listener);
      return () => ipcRenderer.removeListener('native-module:downloadCancelled', listener);
    },
    onDownloadError: (callback: (data: { packageName: string; error: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('native-module:downloadError', listener);
      return () => ipcRenderer.removeListener('native-module:downloadError', listener);
    },
  },

  // Browser Control management
  browserControl: {
    invoke: invokeBrowserControl,
    // Main → Renderer event listeners (to be migrated to connectMainToRender later)
    onPhaseChange: (callback: (phase: string, message?: string) => void) => {
      const listener = (_event: any, phase: string, message?: string) => callback(phase, message);
      ipcRenderer.on('browserControl:phaseChange', listener);
      return () => ipcRenderer.removeListener('browserControl:phaseChange', listener);
    },
    onDownloadProgress: (callback: (progress: { percent: number; transferred: string; total: string }) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('browserControl:downloadProgress', listener);
      return () => ipcRenderer.removeListener('browserControl:downloadProgress', listener);
    },
    onUpdatePhaseChange: (callback: (phase: string, message?: string) => void) => {
      const listener = (_event: any, phase: string, message?: string) => callback(phase, message);
      ipcRenderer.on('browserControl:updatePhaseChange', listener);
      return () => ipcRenderer.removeListener('browserControl:updatePhaseChange', listener);
    },
    onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: string; total: string }) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('browserControl:updateDownloadProgress', listener);
      return () => ipcRenderer.removeListener('browserControl:updateDownloadProgress', listener);
    },
    onShowBrowserInstallConfirm: (callback: (data: { requestId: string; browserName: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browserControl:showBrowserInstallConfirm', listener);
      return () => ipcRenderer.removeListener('browserControl:showBrowserInstallConfirm', listener);
    },
    onShowNativeServerDownloadConfirm: (callback: (data: { requestId: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browserControl:showNativeServerDownloadConfirm', listener);
      return () => ipcRenderer.removeListener('browserControl:showNativeServerDownloadConfirm', listener);
    },
    onShowBrowserRestartConfirm: (callback: (data: { requestId: string; browserName: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('browserControl:showBrowserRestartConfirm', listener);
      return () => ipcRenderer.removeListener('browserControl:showBrowserRestartConfirm', listener);
    },
  },

  // DevTools MCP
  devToolsMcp: {
    enable: () => ipcRenderer.invoke('devToolsMcp:enable'),
    disable: () => ipcRenderer.invoke('devToolsMcp:disable'),
    getStatus: () => ipcRenderer.invoke('devToolsMcp:getStatus'),
    getSettings: () => ipcRenderer.invoke('devToolsMcp:getSettings'),
    updateSettings: (settings: { browser?: 'chrome' | 'edge' }) => ipcRenderer.invoke('devToolsMcp:updateSettings', settings),
  },

  // Memex Memory (per-agent Zettelkasten)
  memex: createMemexPreloadApi(ipcRenderer),

  // Scheduler Management
  scheduler: {
    invoke: invokeScheduler,
  },

  // Buddy Companion
  buddy: {
    invoke: invokeBuddy,
    on: ipcRenderer.on.bind(ipcRenderer),
    off: ipcRenderer.off.bind(ipcRenderer),
  },


  mcpAuth: {
    onShowConsent: (callback: (data: { requestId: string; serverName: string; providerLabel: string }) => void) => {
      const listener = (_event: any, data: { requestId: string; serverName: string; providerLabel: string }) => callback(data);
      ipcRenderer.on('mcpAuth:showConsent', listener);
      return () => ipcRenderer.removeListener('mcpAuth:showConsent', listener);
    },
    respondConsent: (requestId: string, decision: 'cancel' | 'allow-this-time') =>
      ipcRenderer.invoke('mcpAuth:respondConsent', requestId, decision),
    onRequestClientId: (callback: (data: McpAuthClientIdRequestPayload) => void) => {
      const listener = (_event: any, data: McpAuthClientIdRequestPayload) => callback(data);
      ipcRenderer.on('mcpAuth:requestClientId', listener);
      return () => ipcRenderer.removeListener('mcpAuth:requestClientId', listener);
    },
    respondClientId: (
      requestId: string,
      response: McpAuthClientIdResponse,
    ) => ipcRenderer.invoke('mcpAuth:respondClientId', requestId, response),
  },

  // Generic event listening methods for main window IPC events
  on: (channel: string, callback: (data: any) => void) => {
    // Whitelist of allowed channels for security
    const allowedChannels = ['navigate:to', 'app:debugInfoDownloaded'];
    if (!allowedChannels.includes(channel)) {
      return () => {}; // Return empty cleanup function
    }

    const listener = (event: any, data: any) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  off: (channel: string, callback: (data: any) => void) => {
    // Security check for allowed channels
    const allowedChannels = ['navigate:to', 'app:debugInfoDownloaded'];
    if (!allowedChannels.includes(channel)) {
      return;
    }

    ipcRenderer.removeListener(channel, callback);
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if ((process as any).contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  } catch (error) {
  }
} else {
  // Fallback for when context isolation is disabled
  (window as any).electronAPI = electronAPI;
}
