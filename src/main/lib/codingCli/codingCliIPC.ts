/**
 * codingCliIPC - type-safe IPC bridge for the profile-level Coding CLI setting.
 *
 * Exposes three operations to the renderer Settings page:
 *   - getSettings: read the active profile's coding-agent enabled state and selected coding CLI
 *   - updateSettings: persist the master switch and/or CLI selection to the active profile
 *   - detectAvailability: probe which CLIs are installed on PATH
 *
 * OpenKosmos only detects availability and persists the preference; it never installs or updates CLIs.
 */

import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/codingCli';
import { CODING_CLI_IDS } from '@shared/types/codingCli';
import type { CodingCliId } from '@shared/types/codingCli';
import { profileCacheManager } from '../userDataADO';
import { DEFAULT_CODING_AGENT_SETTINGS } from '../userDataADO/types/profile';
import { detectAllAvailability } from '../mcpRuntime/builtinTools/codingCli/registry';

type CodingCliSettingsPatch = {
  enabled?: boolean;
  cli?: CodingCliId;
};

type ValidationResult =
  | { success: true; settings: CodingCliSettingsPatch }
  | { success: false; error: string };

function validateSettingsPatch(settings: unknown): ValidationResult {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { success: false, error: 'Coding CLI settings must be an object' };
  }

  const candidate = settings as Record<string, unknown>;
  const allowedKeys = new Set(['enabled', 'cli']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      return { success: false, error: `Unsupported Coding CLI setting: ${key}` };
    }
  }

  const patch: CodingCliSettingsPatch = {};
  if ('enabled' in candidate) {
    if (typeof candidate.enabled !== 'boolean') {
      return { success: false, error: 'enabled must be a boolean' };
    }
    patch.enabled = candidate.enabled;
  }

  if ('cli' in candidate) {
    if (typeof candidate.cli !== 'string' || !CODING_CLI_IDS.includes(candidate.cli as CodingCliId)) {
      return { success: false, error: 'cli must be one of: claude, codex, gemini, copilot' };
    }
    patch.cli = candidate.cli as CodingCliId;
  }

  return { success: true, settings: patch };
}

export interface CodingCliIPCDeps {
  /** Resolve the active user alias (null when no user is signed in). */
  getAlias: () => string | null;
}

export function registerCodingCliIPC(deps: CodingCliIPCDeps): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getSettings(async () => {
    const alias = deps.getAlias();
    if (!alias) {
      return { success: true, data: { ...DEFAULT_CODING_AGENT_SETTINGS } };
    }
    return { success: true, data: profileCacheManager.getCodingAgentSettings(alias) };
  });

  handle.updateSettings(async (_e, settings) => {
    const alias = deps.getAlias();
    if (!alias) {
      return { success: false, error: 'No active user profile' };
    }
    const validation = validateSettingsPatch(settings);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    const ok = await profileCacheManager.updateCodingAgentSettings(alias, validation.settings);
    return ok ? { success: true } : { success: false, error: 'Failed to persist coding CLI settings' };
  });

  handle.detectAvailability(async () => {
    return { success: true, data: { clis: await detectAllAvailability() } };
  });
}
