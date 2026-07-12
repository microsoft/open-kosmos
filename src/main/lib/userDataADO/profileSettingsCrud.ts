/**
 * Profile settings CRUD operations — get/update for various settings sub-objects.
 * Extracted from ProfileCacheManager for modularity.
 *
 * All update methods use the shared per-profile write lock and commit cache
 * only after profile.json is persisted.
 */

import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  VoiceInputSettings,
  DevToolsMcpSettings,
  CodingAgentSettings,
  SyncSettings,
  ConfirmationSettings,
  BrowserSettings,
  MemexSettings,
  ComputerUseSettings,
  DEFAULT_VOICE_INPUT_SETTINGS,
  DEFAULT_DEVTOOLS_MCP_SETTINGS,
  DEFAULT_CODING_AGENT_SETTINGS,
  DEFAULT_SYNC_SETTINGS,
  DEFAULT_CONFIRMATION_SETTINGS,
  DEFAULT_BROWSER_SETTINGS,
  DEFAULT_MEMEX_SETTINGS,
  DEFAULT_COMPUTER_USE_SETTINGS,
  isProfileV2,
} from './types/profile';
import { CODING_CLI_IDS } from '@shared/types/codingCli';
import { withProfileWriteLock, writeProfileThenCommitCache } from './profileEntityCrud';

const logger = createConsoleLogger();

function isCodingCliId(value: unknown): value is CodingAgentSettings['cli'] {
  return typeof value === 'string' && (CODING_CLI_IDS as readonly string[]).includes(value);
}

function normalizeCodingAgentSettings(settings: Partial<CodingAgentSettings> | undefined): CodingAgentSettings {
  return {
    ...DEFAULT_CODING_AGENT_SETTINGS,
    enabled: settings?.enabled === true,
    cli: isCodingCliId(settings?.cli) ? settings.cli : DEFAULT_CODING_AGENT_SETTINGS.cli,
  };
}

function validateCodingAgentSettingsPatch(settings: Partial<CodingAgentSettings>): Partial<CodingAgentSettings> | null {
  const patch: Partial<CodingAgentSettings> = {};
  if ('enabled' in settings) {
    if (typeof settings.enabled !== 'boolean') return null;
    patch.enabled = settings.enabled;
  }
  if ('cli' in settings) {
    if (!isCodingCliId(settings.cli)) return null;
    patch.cli = settings.cli;
  }
  return patch;
}

/**
 * Context interface for settings CRUD operations.
 * Provides access to the ProfileCacheManager internals needed by these operations.
 */
export interface SettingsCrudContext {
  cache: Map<string, ProfileV2>;
  readProfileFromFile(alias: string): Promise<ProfileV2 | null>;
  writeProfileToFile(alias: string, profile: ProfileV2): Promise<boolean>;
  notifyProfileDataManager(alias: string, immediate?: boolean): Promise<void>;
}

async function loadProfileForSettings(ctx: SettingsCrudContext, alias: string): Promise<ProfileV2 | null> {
  const profile = ctx.cache.get(alias) ?? (await ctx.readProfileFromFile(alias)) ?? undefined;
  return profile && isProfileV2(profile) ? profile : null;
}

// ═══════ Confirmation ═══════

export function getConfirmationSettings(ctx: SettingsCrudContext, alias: string): ConfirmationSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile || !isProfileV2(profile) || !profile.confirmationSettings) {
      return { ...DEFAULT_CONFIRMATION_SETTINGS };
    }
    return {
      ...DEFAULT_CONFIRMATION_SETTINGS,
      ...profile.confirmationSettings,
      inlineEditRegenerate: {
        ...DEFAULT_CONFIRMATION_SETTINGS.inlineEditRegenerate,
        ...profile.confirmationSettings.inlineEditRegenerate,
      },
    };
  } catch (error) {
    return { ...DEFAULT_CONFIRMATION_SETTINGS };
  }
}

export async function updateConfirmationSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<ConfirmationSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.confirmationSettings || { ...DEFAULT_CONFIRMATION_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        confirmationSettings: {
          ...currentSettings,
          ...settings,
          inlineEditRegenerate: {
            ...DEFAULT_CONFIRMATION_SETTINGS.inlineEditRegenerate,
            ...currentSettings.inlineEditRegenerate,
            ...settings.inlineEditRegenerate,
          },
        },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ Voice Input ═══════

export function getVoiceInputSettings(ctx: SettingsCrudContext, alias: string): VoiceInputSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.voiceInputSettings) {
      return profile.voiceInputSettings;
    }
    return { ...DEFAULT_VOICE_INPUT_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_VOICE_INPUT_SETTINGS };
  }
}

export async function updateVoiceInputSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<VoiceInputSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.voiceInputSettings || { ...DEFAULT_VOICE_INPUT_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        voiceInputSettings: { ...currentSettings, ...settings },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ Primary Chat ═══════

export async function updatePrimaryChat(ctx: SettingsCrudContext, alias: string, chatId: string): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const chatExists = profile.chats.some(chat => chat.chat_id === chatId);
      if (!chatExists) return false;
      if (profile.primaryChat === chatId) return true;

      const nextProfile: ProfileV2 = {
        ...profile,
        primaryChat: chatId,
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ FRE (First Run Experience) ═══════

export async function updateFreDone(ctx: SettingsCrudContext, alias: string, freDone: boolean): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;
      if (profile.freDone === freDone) return true;

      const nextProfile: ProfileV2 = {
        ...profile,
        freDone,
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

export function getFreDone(ctx: SettingsCrudContext, alias: string): boolean {
  try {
    const profile = ctx.cache.get(alias);
    if (!profile) return false;
    return profile.freDone === true;
  } catch (error) {
    return false;
  }
}

// ═══════ Embedded Browser (per-profile feature switch) ═══════

export function getBrowserSettings(ctx: SettingsCrudContext, alias: string): BrowserSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.browser) {
      return { ...DEFAULT_BROWSER_SETTINGS, ...profile.browser };
    }
    return { ...DEFAULT_BROWSER_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_BROWSER_SETTINGS };
  }
}

export async function updateBrowserSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<BrowserSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.browser || { ...DEFAULT_BROWSER_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        browser: { ...currentSettings, ...settings },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ Memex Memory (per-profile feature switch) ═══════

export function getMemexSettings(ctx: SettingsCrudContext, alias: string): MemexSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.memex) {
      return { ...DEFAULT_MEMEX_SETTINGS, ...profile.memex };
    }
    return { ...DEFAULT_MEMEX_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_MEMEX_SETTINGS };
  }
}

export async function updateMemexSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<MemexSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.memex || { ...DEFAULT_MEMEX_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        memex: { ...currentSettings, ...settings },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ Computer Use (per-profile feature switch) ═══════

const COMPUTER_USE_SETTING_KEYS = new Set(['enabled', 'alwaysAllowedApps', 'requireConfirmation']);

export function normalizeComputerUseSettingsPatch(settings: unknown): Partial<ComputerUseSettings> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }

  const raw = settings as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!COMPUTER_USE_SETTING_KEYS.has(key)) {
      return null;
    }
  }

  const patch: Partial<ComputerUseSettings> = {};
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') {
      return null;
    }
    patch.enabled = raw.enabled;
  }
  if ('requireConfirmation' in raw) {
    if (typeof raw.requireConfirmation !== 'boolean') {
      return null;
    }
    patch.requireConfirmation = raw.requireConfirmation;
  }
  if ('alwaysAllowedApps' in raw) {
    if (!Array.isArray(raw.alwaysAllowedApps)) {
      return null;
    }
    const apps: string[] = [];
    for (const app of raw.alwaysAllowedApps) {
      if (typeof app !== 'string') {
        return null;
      }
      if (app.trim().length > 0) {
        apps.push(app);
      }
    }
    patch.alwaysAllowedApps = apps;
  }

  return patch;
}

function normalizeComputerUseSettingsValue(settings: unknown): ComputerUseSettings {
  const normalizedPatch = normalizeComputerUseSettingsPatch(settings);
  if (!normalizedPatch) {
    return { ...DEFAULT_COMPUTER_USE_SETTINGS };
  }

  return {
    ...DEFAULT_COMPUTER_USE_SETTINGS,
    ...normalizedPatch,
    enabled: normalizedPatch.enabled === true,
    requireConfirmation: normalizedPatch.requireConfirmation !== false,
    alwaysAllowedApps: normalizedPatch.alwaysAllowedApps || [],
  };
}

export function getComputerUseSettings(ctx: SettingsCrudContext, alias: string): ComputerUseSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.computerUse) {
      return normalizeComputerUseSettingsValue(profile.computerUse);
    }
    return { ...DEFAULT_COMPUTER_USE_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_COMPUTER_USE_SETTINGS };
  }
}

export async function updateComputerUseSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<ComputerUseSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const normalizedPatch = normalizeComputerUseSettingsPatch(settings);
      if (!normalizedPatch) {
        logger.warn('[ProfileSettingsCrud] Invalid Computer Use settings patch rejected', 'updateComputerUseSettings', { alias });
        return false;
      }

      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = normalizeComputerUseSettingsValue(profile.computerUse);
      const mergedSettings = { ...currentSettings, ...normalizedPatch };
      const nextProfile: ProfileV2 = {
        ...profile,
        // Keep the in-memory cache as strict as the on-disk sanitizer, because
        // writeProfileThenCommitCache caches this raw object before sanitizeProfileV2 runs.
        computerUse: normalizeComputerUseSettingsValue(mergedSettings),
      };
      const success = await writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
      logger.info('[ProfileSettingsCrud] Computer Use settings update completed', 'updateComputerUseSettings', {
        alias,
        success,
        previousEnabled: currentSettings.enabled === true,
        nextEnabled: nextProfile.computerUse?.enabled === true,
        patchKeys: Object.keys(normalizedPatch).sort(),
        alwaysAllowedAppCount: nextProfile.computerUse?.alwaysAllowedApps.length ?? 0,
        requireConfirmation: nextProfile.computerUse?.requireConfirmation !== false,
      });
      return success;
    } catch (error) {
      logger.warn('[ProfileSettingsCrud] Computer Use settings update failed', 'updateComputerUseSettings', {
        alias,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  });
}

// ═══════ Coding Agent ═══════

export function getCodingAgentSettings(ctx: SettingsCrudContext, alias: string): CodingAgentSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.codingAgentSettings) {
      return normalizeCodingAgentSettings(profile.codingAgentSettings);
    }
    return { ...DEFAULT_CODING_AGENT_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_CODING_AGENT_SETTINGS };
  }
}

export async function updateCodingAgentSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<CodingAgentSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const validatedPatch = validateCodingAgentSettingsPatch(settings);
      if (!validatedPatch) return false;

      const currentSettings = normalizeCodingAgentSettings(profile.codingAgentSettings);
      const nextProfile: ProfileV2 = {
        ...profile,
        codingAgentSettings: { ...currentSettings, ...validatedPatch },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ DevTools MCP ═══════

export function getDevToolsMcpSettings(ctx: SettingsCrudContext, alias: string): DevToolsMcpSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.devToolsMcpSettings) {
      return profile.devToolsMcpSettings;
    }
    return { ...DEFAULT_DEVTOOLS_MCP_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_DEVTOOLS_MCP_SETTINGS };
  }
}

export async function updateDevToolsMcpSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<DevToolsMcpSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.devToolsMcpSettings || { ...DEFAULT_DEVTOOLS_MCP_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        devToolsMcpSettings: { ...currentSettings, ...settings },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}

// ═══════ Sync Settings ═══════

export function getSyncSettings(ctx: SettingsCrudContext, alias: string): SyncSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.syncSettings) {
      return { ...DEFAULT_SYNC_SETTINGS, ...profile.syncSettings };
    }
    return { ...DEFAULT_SYNC_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

export async function updateSyncSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<SyncSettings>): Promise<boolean> {
  return withProfileWriteLock(alias, async () => {
    try {
      const profile = await loadProfileForSettings(ctx, alias);
      if (!profile) return false;

      const currentSettings = profile.syncSettings || { ...DEFAULT_SYNC_SETTINGS };
      const nextProfile: ProfileV2 = {
        ...profile,
        syncSettings: { ...currentSettings, ...settings },
      };
      return writeProfileThenCommitCache(ctx, alias, profile, nextProfile, true);
    } catch (error) {
      return false;
    }
  });
}
