/**
 * Profile settings CRUD operations — get/update for various settings sub-objects.
 * Extracted from ProfileCacheManager for modularity.
 *
 * All update methods follow the same pattern:
 *   1. Get profile from cache (or read from file)
 *   2. Merge settings
 *   3. Update cache
 *   4. Notify frontend
 *   5. Write to file
 */

import { createConsoleLogger } from '../unifiedLogger';
import {
  ProfileV2,
  VoiceInputSettings,
  BrowserControlSettings,
  DevToolsMcpSettings,
  ConfirmationSettings,
  DEFAULT_VOICE_INPUT_SETTINGS,
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  DEFAULT_DEVTOOLS_MCP_SETTINGS,
  DEFAULT_CONFIRMATION_SETTINGS,
  isProfileV2,
} from './types/profile';

const logger = createConsoleLogger();

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
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const currentSettings = profile.confirmationSettings || { ...DEFAULT_CONFIRMATION_SETTINGS };
    profile.confirmationSettings = {
      ...currentSettings,
      ...settings,
      inlineEditRegenerate: {
        ...DEFAULT_CONFIRMATION_SETTINGS.inlineEditRegenerate,
        ...currentSettings.inlineEditRegenerate,
        ...settings.inlineEditRegenerate,
      },
    };
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
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
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const currentSettings = profile.voiceInputSettings || { ...DEFAULT_VOICE_INPUT_SETTINGS };
    profile.voiceInputSettings = { ...currentSettings, ...settings };
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
}

// ═══════ Primary Agent ═══════

export async function updatePrimaryAgent(ctx: SettingsCrudContext, alias: string, agentName: string): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const agentExists = profile.chats.some(chat => chat.agent?.name === agentName);
    if (!agentExists) return false;
    if (profile.primaryAgent === agentName) return true;

    profile.primaryAgent = agentName;
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
}

// ═══════ FRE (First Run Experience) ═══════

export async function updateFreDone(ctx: SettingsCrudContext, alias: string, freDone: boolean): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (profile.freDone === freDone) return true;

    profile.freDone = freDone;
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
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

// ═══════ Browser Control ═══════

export function getBrowserControlSettings(ctx: SettingsCrudContext, alias: string): BrowserControlSettings {
  try {
    const profile = ctx.cache.get(alias);
    if (profile && isProfileV2(profile) && profile.browserControl) {
      return profile.browserControl;
    }
    return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
  }
}

export async function updateBrowserControlSettings(ctx: SettingsCrudContext, alias: string, settings: Partial<BrowserControlSettings>): Promise<boolean> {
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const currentSettings = profile.browserControl || { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
    profile.browserControl = { ...currentSettings, ...settings };
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
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
  try {
    let profile = ctx.cache.get(alias);
    if (!profile) {
      const fileProfile = await ctx.readProfileFromFile(alias);
      if (!fileProfile) return false;
      profile = fileProfile;
    }
    if (!isProfileV2(profile)) return false;

    const currentSettings = profile.devToolsMcpSettings || { ...DEFAULT_DEVTOOLS_MCP_SETTINGS };
    profile.devToolsMcpSettings = { ...currentSettings, ...settings };
    ctx.cache.set(alias, profile);
    await ctx.notifyProfileDataManager(alias, true);
    return await ctx.writeProfileToFile(alias, profile);
  } catch (error) {
    return false;
  }
}

