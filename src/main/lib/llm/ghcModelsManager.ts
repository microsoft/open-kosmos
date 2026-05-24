// src/main/lib/llm/ghcModelsManager.ts
/**
 * GhcModelsManager — Single source of truth for the GitHub Copilot model list (backend)
 *
 * Responsibilities:
 *   1. In-memory cache (dynamic model list)
 *   2. Local file persistence ({userData}/profiles/{alias}/github-copilot-models.json)
 *   3. Remote fetch updates (https://api.githubcopilot.com/models)
 *
 * Initialization flow (local-cache-first, remote refresh in background):
 *   When initialize(alias) is called:
 *     a. Load the model list from the local persistence file into the in-memory cache and immediately notify the renderer
 *     b. Fire-and-forget call to refreshFromRemote() in the background to fetch the latest remote list
 *        - Success and passes integrity check → update cache + persist + notify renderer again
 *        - Failure or integrity check fails → keep local cache unchanged
 *     c. initialize() returns as soon as local cache is loaded, without waiting for the remote fetch
 *
 * Integrity check:
 *   refreshFromRemote() checks whether the remote list contains Claude models before updating the cache.
 *   In some network environments (e.g. without a VPN), the remote may not return Claude models; in that case
 *   the update is rejected to prevent locally cached Claude models from being overwritten. Protection is only
 *   triggered when the remote has no Claude models but the local cache does; if neither side has Claude, the
 *   update proceeds normally.
 *
 * Models used by OpenKosmos are dynamically matched from the GHC model set via OPENKOSMOS_MODEL_PATTERNS,
 * eliminating the need to manually maintain a static ID list — new models matching an existing pattern
 * are automatically included when they go live on GHC.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, app } from 'electron';
import { GhcCopilotModel } from '@shared/types/ghcChatTypes';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { createLogger } from '../unifiedLogger';
import { MainAuthManager } from "../auth/authManager";
const logger = createLogger();

// ============================================================================
// Constants
// ============================================================================

/** Local persistence file name */
const MODELS_FILE_NAME = 'github-copilot-models.json';

/**
 * OpenKosmos model matching rules (dynamically filtered from the full GHC model set)
 *
 * Version constraints (derived from the version range covered by the original OpenKosmos_USED_MODEL_IDS):
 *   - Claude  ≥ 4.0 : claude-(opus|sonnet)-4, 4.5, 4.6, 5, … — excludes haiku
 *   - Gemini  ≥ 2.5 : gemini-2.5-pro, gemini-3-pro, …        — excludes flash
 *   - GPT     > 5.0 : gpt-5.1, gpt-5.2-codex, gpt-6, …      — excludes mini
 *
 * Common rules:
 *   1. capabilities.type === 'chat' (excludes embeddings / completion)
 *   2. Exclude lightweight models (mini / flash / haiku)
 *   3. Exclude reasoning-only models (o3 / o4 series)
 *   4. model_picker_enabled === true (models not enabled are not shown)
 *
 * Each group's include regex captures the model IDs of that vendor series we want;
 * the global exclude regex uniformly filters out lightweight / reasoning variants from the final result.
 */

/** Matching rule: include represents the regex for model IDs to include */
const OPENKOSMOS_MODEL_PATTERNS: { include: RegExp; sortGroup: number }[] = [
  // Claude ≥4.0 opus / sonnet (excludes haiku)
  // Matches claude-(opus|sonnet)-4, 4.5, 4.6, 5, 10, … (major version ≥4)
  { include: /^claude-(opus|sonnet)-([4-9]|\d{2,})/, sortGroup: 0 },
  // Gemini ≥2.5 pro series (excludes flash)
  // Matches gemini-2.5-pro, gemini-3-pro, gemini-10-pro, … (major version ≥3 or 2.5+)
  { include: /^gemini-(2\.[5-9]|2\.\d{2,}|[3-9]|\d{2,}).*pro/, sortGroup: 1 },
  // GPT >5.0 (i.e. 5.1+, 6, 7, …) — excludes gpt-5.0 and gpt-4.x
  // Matches gpt-5.1, gpt-5.2-codex, gpt-6, gpt-10, … (major version ≥6 or 5.1+)
  { include: /^gpt-(5\.[1-9]|5\.\d{2,}|[6-9]|\d{2,})/, sortGroup: 2 },
];

/** Global exclusion: lightweight and reasoning-only variants (\b prevents matching "mini" inside "gemini") */
const OPENKOSMOS_MODEL_EXCLUDE = /\bmini|\bflash|\bhaiku/i;

// Model categories for UI organization (dynamically maintained is not needed here, kept for backward compat)
const MODEL_CATEGORIES = {
  claude: ['claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.6-1m', 'claude-opus-41'],
  gpt: ['gpt-4.1', 'gpt-5', 'gpt-4o', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  reasoning: ['o3-mini', 'o3', 'o4-mini']
};

// ============================================================================
// GhcModelsManager singleton
// ============================================================================

class GhcModelsManager {
  private static instance: GhcModelsManager;

  /** In-memory cache — the full set of currently active models */
  private modelsCache: GhcCopilotModel[] = [];

  /** Whether initialization has completed */
  private initialized = false;

  /** In-progress initialization Promise (used to prevent race conditions) */
  private initializationPromise: Promise<void> | null = null;

  /** Current user profile alias (used to locate the persistence file path) */
  private currentAlias: string | null = null;

  private constructor() {}

  static getInstance(): GhcModelsManager {
    if (!GhcModelsManager.instance) {
      GhcModelsManager.instance = new GhcModelsManager();
    }
    return GhcModelsManager.instance;
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the model manager
   * @param alias Current user profile alias (used to locate profiles/{alias}/github-copilot-models.json)
   * 1. Load the model list from the local profile directory file
   * 2. If the file does not exist or the model list is empty, fetch the latest model list from remote and persist it
   */
  async initialize(alias?: string): Promise<void> {
    // If a new alias is provided and differs from the current one, re-initialize
    if (alias && alias !== this.currentAlias) {
      this.currentAlias = alias;
      this.initialized = false;
      this.initializationPromise = null;
    }

    if (this.initialized) {
      return;
    }

    // If initialization is already in progress, wait for it to complete
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Create and store the initialization Promise so other callers can await it
    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  /** Internal method that performs the actual initialization */
  private async _doInitialize(): Promise<void> {

    logger.debug(`[GhcModelsManager] Initializing${this.currentAlias ? ` for alias: ${this.currentAlias}` : ''}...`);

    try {
      // 1. Load from local cache first, so the model list is available even if the network is unavailable
      const loaded = await this.loadFromFile();
      if (loaded && this.modelsCache.length > 0) {
        logger.debug(`[GhcModelsManager] Loaded ${this.modelsCache.length} models from local cache`);
      } else {
        logger.debug('[GhcModelsManager] No local cache available, will rely on remote fetch');
      }
    } catch (error) {
      logger.error(`[GhcModelsManager] Initialization error: ${error instanceof Error ? error.message : String(error)}`)
    }

    this.initialized = true;
    logger.debug(`[GhcModelsManager] Initialized with ${this.modelsCache.length} models (from local cache)`);

    // 2. Immediately notify the renderer with the locally cached model data (if any), so the UI can render first
    if (this.modelsCache.length > 0) {
      this.notifyRenderer();
    }

    // 3. Fetch the latest remote list in the background; on success, refreshFromRemote will update the cache and call notifyRenderer again
    this.refreshFromRemote().catch(err => {
      logger.warn(`[GhcModelsManager] Background remote refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Notify all renderer processes that model data has been updated */
  private notifyRenderer(): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('models:updated', {
            count: this.modelsCache.length,
            timestamp: Date.now()
          });
        }
      }
      logger.debug(`[GhcModelsManager] Notified ${windows.length} renderer(s) — models:updated (${this.modelsCache.length} models)`);
    } catch (error) {
      logger.warn(`[GhcModelsManager] Failed to notify renderer: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ==========================================================================
  // Local file read/write
  // ==========================================================================

  /**
   * Get the full path to the local persistence file
   * Path format: {userData}/profiles/{alias}/github-copilot-models.json
   * @throws If alias is not set or the Electron app is unavailable
   */
  private getFilePath(): string {
    if (!this.currentAlias) {
      throw new Error('[GhcModelsManager] currentAlias is not set. Call initialize(alias) first.');
    }
    const electronApp = this.getElectronApp();
    if (!electronApp) {
      throw new Error('[GhcModelsManager] Electron app is not available.');
    }
    const appPath = electronApp.getPath('userData');
    const profileDir = path.join(appPath, 'profiles', this.currentAlias);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    return path.join(profileDir, MODELS_FILE_NAME);
  }

  /** Get the Electron app instance (supports mock in test environments) */
  private getElectronApp(): any {
    try {
      if ((global as any).electron?.app) {
        return (global as any).electron.app;
      }
      return app;
    } catch {
      return null;
    }
  }

  /** Load the model list from the local file */
  private async loadFromFile(): Promise<boolean> {
    try {
      const filePath = this.getFilePath();
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Supports two formats: a bare array or { models: [...], updatedAt: ... }
      if (Array.isArray(parsed)) {
        this.modelsCache = parsed;
      } else if (parsed && Array.isArray(parsed.models)) {
        this.modelsCache = parsed.models;
      } else {
        logger.warn('[GhcModelsManager] Invalid file format');
        return false;
      }

      return this.modelsCache.length > 0;
    } catch (error) {
      logger.error(`[GhcModelsManager] Failed to read local file: ${error instanceof Error ? error.message : String(error)}`)
      return false;
    }
  }

  /** Save the current in-memory cache to the local file */
  private async saveToFile(): Promise<boolean> {
    try {
      const filePath = this.getFilePath();
      const data = {
        models: this.modelsCache,
        updatedAt: new Date().toISOString(),
        count: this.modelsCache.length
      };
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug(`[GhcModelsManager] Saved ${this.modelsCache.length} models to ${filePath}`);
      return true;
    } catch (error) {
      logger.error(`[GhcModelsManager] Failed to save to file: ${error instanceof Error ? error.message : String(error)}`)
      return false;
    }
  }

  // ==========================================================================
  // Remote fetch updates
  // ==========================================================================

  /**
   * Fetch the latest model list from the remote API and update the cache and local file.
   * Requires a valid Copilot token.
   */
  async refreshFromRemote(): Promise<boolean> {
    logger.debug('[GhcModelsManager] Fetching models from remote API...');

    try {
      // Get the copilot token
      const authManager = MainAuthManager.getInstance();
      let token = authManager.getCopilotAccessToken();

      // If the copilot token is empty, attempt a single refresh
      if (!token) {
        logger.debug('[GhcModelsManager] Copilot token not available, attempting token refresh...');
        try {
          const refreshResult = await authManager.refreshCopilotToken();
          if (refreshResult.success) {
            token = authManager.getCopilotAccessToken();
            logger.debug(`[GhcModelsManager] Token refresh succeeded, token available: ${!!token}`);
          } else {
            logger.warn(`[GhcModelsManager] Token refresh failed: ${refreshResult.error}`);
          }
        } catch (refreshError) {
          logger.warn(`[GhcModelsManager] Token refresh error: ${refreshError}`);
        }
      }

      if (!token) {
        logger.warn('[GhcModelsManager] No access token available after refresh attempt, skipping remote fetch');
        return false;
      }

      const url = `${GHC_CONFIG.API_ENDPOINT}/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION,
          'Copilot-Integration-Id': 'vscode-chat'
        }
      });

      if (!response.ok) {
        logger.error(`[GhcModelsManager] Remote fetch failed: ${response.status} ${response.statusText}`);
        return false;
      }

      const data = await response.json();
      let models: GhcCopilotModel[] = [];

      // GitHub Copilot API response format: { data: [...] } or a bare array
      if (Array.isArray(data)) {
        models = data;
      } else if (data && Array.isArray(data.data)) {
        models = data.data;
      } else {
        logger.warn('[GhcModelsManager] Unexpected API response format');
        return false;
      }

      if (models.length === 0) {
        logger.warn('[GhcModelsManager] Remote returned empty model list, keeping existing cache');
        return false;
      }

      // Integrity check: the remote list must include Claude models to be considered complete.
      // In some network environments (e.g. without a VPN), the remote may not return Claude models;
      // in that case we must not overwrite the local cache.
      const hasClaudeModels = models.some(m => /^claude-/i.test(m.id));
      const localHasClaude = this.modelsCache.some(m => /^claude-/i.test(m.id));
      if (!hasClaudeModels && localHasClaude) {
        logger.warn(`[GhcModelsManager] Remote list has ${models.length} models but missing Claude models (local cache has Claude). Keeping local cache to prevent model loss.`);
        return false;
      }

      logger.debug(`[GhcModelsManager] Remote list integrity check passed (claude=${hasClaudeModels}, localHadClaude=${localHasClaude})`);

      // Update the in-memory cache
      this.modelsCache = models;

      // Persist to local file
      await this.saveToFile();

      // Notify the renderer that model data has been updated
      this.notifyRenderer();

      logger.debug(`[GhcModelsManager] Successfully refreshed ${models.length} models from remote`);
      return true;
    } catch (error) {
      logger.error(`[GhcModelsManager] Remote fetch error: ${error instanceof Error ? error.message : String(error)}`)
      return false;
    }
  }

  // ==========================================================================
  // Public query API — consistent with the exported functions in the old ghcModels.ts
  // ==========================================================================

  /** Get all models */
  getAllModels(): GhcCopilotModel[] {
    this.ensureInitialized();
    return this.modelsCache;
  }

  /**
   * Get the list of models used by OpenKosmos (dynamically matched from the full GHC model set)
   *
   * Matching logic:
   *   1. capabilities.type === 'chat'
   *   2. model_picker_enabled === true
   *   3. Model ID matches at least one OPENKOSMOS_MODEL_PATTERNS include regex
   *      (Claude ≥4.0 opus/sonnet, Gemini ≥2.5 pro, GPT >5.0)
   *   4. Model ID does not match OPENKOSMOS_MODEL_EXCLUDE (mini/flash/haiku)
   *
   * Sort: grouped by sortGroup (Claude → Gemini → GPT), within each group sorted by ID descending
   * (leveraging the natural alphabetical ordering of version numbers; newer versions have larger digits/letters,
   * so descending order means "newest first")
   */
  getAllOpenKosmosUsedModels(): GhcCopilotModel[] {
    this.ensureInitialized();

    // Collect matched models with their sortGroup information
    const matched: { model: GhcCopilotModel; sortGroup: number }[] = [];

    for (const model of this.modelsCache) {
      // Keep only chat-type models that are enabled in the model picker
      if (model.capabilities.type !== 'chat' || !model.model_picker_enabled) {
        continue;
      }

      // Globally exclude lightweight / reasoning-only variants
      if (OPENKOSMOS_MODEL_EXCLUDE.test(model.id)) {
        continue;
      }

      // Check if the model matches any include pattern
      for (const pattern of OPENKOSMOS_MODEL_PATTERNS) {
        if (pattern.include.test(model.id)) {
          matched.push({ model, sortGroup: pattern.sortGroup });
          break; // Each model is assigned to only the first matching group
        }
      }
    }

    // Sort: ascending by sortGroup (Claude=0, Gemini=1, GPT=2), then descending by ID within each group
    matched.sort((a, b) => {
      if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
      return b.model.id.localeCompare(a.model.id);
    });

    return matched.map(m => m.model);
  }

  /** Get a single model by ID */
  getModelById(modelId: string): GhcCopilotModel | undefined {
    this.ensureInitialized();
    return this.modelsCache.find(model => model.id === modelId);
  }

  /** Get the list of models by category */
  getModelsByCategory(category: keyof typeof MODEL_CATEGORIES): GhcCopilotModel[] {
    const modelIds = MODEL_CATEGORIES[category];
    return modelIds.map(id => this.getModelById(id)).filter(Boolean) as GhcCopilotModel[];
  }

  /** Get model capability information */
  getModelCapabilities(modelId: string) {
    const model = this.getModelById(modelId);
    if (!model) return null;

    const reasoningEfforts = normalizeReasoningEfforts(model.capabilities.supports.reasoning_effort);
    const supportsReasoning = reasoningEfforts.length > 0
      || model.capabilities.family.includes('o3')
      || model.capabilities.family.includes('o4');

    return {
      supportsStreaming: model.capabilities.supports.streaming || false,
      supportsTools: model.capabilities.supports.tool_calls || false,
      supportsImages: model.capabilities.supports.vision || false,
      supportsAudio: false,
      supportsVideo: false,
      supportsReasoning,
      reasoningEfforts: reasoningEfforts.length > 0 ? reasoningEfforts : undefined,
      // max_prompt_tokens is the actual API limit on prompt input
      maxContextLength: model.capabilities.limits?.max_prompt_tokens || model.capabilities.limits?.max_context_window_tokens || 0,
      maxOutputLength: model.capabilities.limits?.max_output_tokens || 0,
      supportsTemperature: !model.capabilities.family.includes('o3') && !model.capabilities.family.includes('o4'),
      supportsAttachments: model.capabilities.supports.vision || false,
      tokenizer: (model.capabilities.tokenizer === 'cl100k_base' ? 'cl100k_base' : 'o200k_base') as 'cl100k_base' | 'o200k_base'
    };
  }

  /** Validate whether a model ID is valid */
  validateModelId(modelId: string): boolean {
    this.ensureInitialized();
    return this.modelsCache.some(model => model.id === modelId);
  }

  /** Determine whether a model is a reasoning model (consistent with getModelCapabilities().supportsReasoning) */
  isReasoningModel(modelId: string): boolean {
    return this.getModelCapabilities(modelId)?.supportsReasoning ?? false;
  }

  /** Get the default model ID */
  getDefaultModel(): string {
    return 'claude-sonnet-4.6';
  }

  /** Model categories (static) */
  get MODEL_CATEGORIES() {
    return MODEL_CATEGORIES;
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  /** Warn if not yet initialized (cache may be empty) */
  private ensureInitialized(): void {
    if (!this.initialized) {
      logger.warn('[GhcModelsManager] Not yet initialized. Call initialize(alias) first. Models cache may be empty.');
    }
  }

  /**
   * Wait for initialization to complete (used by IPC handlers and other callers that need data to be ready)
   * If initialization has not started yet, returns after a timeout (will not block forever)
   */
  async waitForInitialization(timeoutMs: number = 15000): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) {
      // Add timeout protection to avoid blocking indefinitely
      await Promise.race([
        this.initializationPromise,
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
      ]);
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

/** Singleton instance */
export const ghcModelsManager = GhcModelsManager.getInstance();

export function getAllModels(): GhcCopilotModel[] {
  return ghcModelsManager.getAllModels();
}

export function getAllOpenKosmosUsedModels(): GhcCopilotModel[] {
  return ghcModelsManager.getAllOpenKosmosUsedModels();
}

export function getModelById(modelId: string): GhcCopilotModel | undefined {
  return ghcModelsManager.getModelById(modelId);
}

export function getModelsByCategory(category: keyof typeof MODEL_CATEGORIES): GhcCopilotModel[] {
  return ghcModelsManager.getModelsByCategory(category);
}

export function getModelCapabilities(modelId: string) {
  return ghcModelsManager.getModelCapabilities(modelId);
}

export function validateModelId(modelId: string): boolean {
  return ghcModelsManager.validateModelId(modelId);
}

export function isReasoningModel(modelId: string): boolean {
  return ghcModelsManager.isReasoningModel(modelId);
}

export function getDefaultModel(): string {
  return ghcModelsManager.getDefaultModel();
}

/**
 * Whether a model requires `max_completion_tokens` instead of `max_tokens`.
 * Newer OpenAI models (GPT-5 series, o-series reasoning models) reject
 * `max_tokens` and only accept `max_completion_tokens`.
 */
export function requiresMaxCompletionTokens(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/^gpt-5/.test(id)) return true;
  if (/^o\d/.test(id)) return true;
  return false;
}

/**
 * Build the correct max-tokens request parameter for a given model.
 * Returns `{ max_tokens: N }` or `{ max_completion_tokens: N }`.
 */
export function buildMaxTokensParam(modelId: string, maxTokens: number): Record<string, number> {
  if (requiresMaxCompletionTokens(modelId)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

/** Canonicalize Copilot-reported effort values: lowercase + dedupe; drops non-strings/empty. */
export function normalizeReasoningEfforts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.length > 0) {
      const lower = v.toLowerCase();
      if (!result.includes(lower)) result.push(lower);
    }
  }
  return result;
}

/**
 * Build reasoning-related request fragment for a given endpoint.
 *
 *   - `/chat/completions`: OpenAI flat form  → `{ reasoning_effort: 'low' }`
 *   - `/responses`        : OpenAI nested form → `{ reasoning: { effort: 'low' } }`
 *
 * Returns an empty object when:
 *   - the model's capabilities do not advertise any reasoning effort tiers, OR
 *   - the resolved effort is not in the supported list.
 *
 * When `reasoningEffort` is omitted (user didn't pick), the function uses
 * `defaultEffort` (vendor-aware heuristic) so that the API always receives
 * an explicit tier for models that support reasoning.
 */
export function buildReasoningParams(opts: {
  endpoint: string;
  supportedEfforts?: string[];
  reasoningEffort?: string;
  defaultEffort?: string;
}): Record<string, unknown> {
  const { endpoint, supportedEfforts, reasoningEffort, defaultEffort } = opts;
  if (!supportedEfforts || supportedEfforts.length === 0) return {};
  const resolved = reasoningEffort ?? defaultEffort;
  if (!resolved) return {};
  const lower = resolved.toLowerCase();
  if (!supportedEfforts.includes(lower)) return {};

  if (endpoint === '/responses') {
    return { reasoning: { effort: lower } };
  }
  return { reasoning_effort: lower };
}

/**
 * Compute the vendor-aware default reasoning effort for a model.
 * Mirrors the renderer heuristic in ReasoningEffortSelector:
 *   - Claude models: high → medium → first
 *   - GPT / others: medium → high → first
 */
export function getDefaultReasoningEffort(modelId: string, supportedEfforts: string[]): string | undefined {
  if (!supportedEfforts || supportedEfforts.length === 0) return undefined;
  const isClaude = modelId.toLowerCase().includes('claude');
  if (isClaude) {
    return supportedEfforts.find(e => e === 'high')
      ?? supportedEfforts.find(e => e === 'medium')
      ?? supportedEfforts[0];
  }
  return supportedEfforts.find(e => e === 'medium')
    ?? supportedEfforts.find(e => e === 'high')
    ?? supportedEfforts[0];
}

/**
 * Wait for GhcModelsManager to finish initializing.
 * IPC handlers should await this before returning data to avoid race conditions.
 */
export async function ensureModelsReady(): Promise<void> {
  return ghcModelsManager.waitForInitialization();
}

export { MODEL_CATEGORIES };
