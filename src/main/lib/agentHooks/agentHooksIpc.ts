/**
 * Agent Hooks IPC registrar (tech-doc §13).
 *
 * Thin orchestrator over the Phase 1 data layer: validates renderer input with
 * the pure `hookInputValidation` helpers, generates identity/timestamps in the
 * main process, and delegates persistence to `profileCacheManager`. The master
 * switch is profile-level.
 *
 * Uses the typed IPC framework (`renderToMain.bindMain`); the startup `Context`
 * supplies the current user alias so the renderer never passes one.
 */

import { randomUUID } from 'crypto';
import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/agentHooks';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import type { Context } from '../../startup/ipc/shared';
import {
  validateCreateHookInput,
  validateUpdateHookPatch,
} from './hookInputValidation';
import type { HookDefinition } from './types';

const logger = createLogger();

let isRegistered = false;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

/** Register all `agentHooks:*` IPC handlers. Idempotent. */
export function registerAgentHooksIPC(ctx: Context): void {
  if (isRegistered) return;

  const handle = renderToMain.bindMain(ipcMain);

  handle.listHooks(async () => {
    try {
      if (!ctx.currentUserAlias) return { success: false, error: 'No current user alias set' };
      return { success: true, data: profileCacheManager.getHooks(ctx.currentUserAlias) };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  handle.createHook(async (_event, input) => {
    try {
      if (!ctx.currentUserAlias) return { success: false, error: 'No current user alias set' };
      const validation = validateCreateHookInput(input);
      if (!validation.ok) return { success: false, error: validation.error };

      const now = new Date().toISOString();
      const hook: HookDefinition = {
        id: randomUUID(),
        name: validation.value.name,
        description: validation.value.description,
        version: '1.0.0',
        remoteVersion: '',
        source: 'ON-DEVICE',
        enabled: validation.value.enabled,
        event: validation.value.event,
        matcher: validation.value.matcher,
        action: validation.value.action,
        createdAt: now,
        updatedAt: now,
      };

      const added = await profileCacheManager.addHook(ctx.currentUserAlias, hook);
      if (!added) return { success: false, error: 'Failed to create hook' };
      return { success: true, hook };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  handle.updateHook(async (_event, hookId, patch) => {
    try {
      if (!ctx.currentUserAlias) return { success: false, error: 'No current user alias set' };
      if (typeof hookId !== 'string' || hookId.length === 0) {
        return { success: false, error: 'Hook id is required' };
      }
      const validation = validateUpdateHookPatch(patch);
      if (!validation.ok) return { success: false, error: validation.error };

      const updated = await profileCacheManager.updateHook(ctx.currentUserAlias, hookId, validation.value);
      if (!updated) return { success: false, error: 'Failed to update hook' };

      const hook = profileCacheManager.getHooks(ctx.currentUserAlias).find(h => h.id === hookId);
      return { success: true, hook };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  handle.deleteHook(async (_event, hookId) => {
    try {
      if (!ctx.currentUserAlias) return { success: false, error: 'No current user alias set' };
      if (typeof hookId !== 'string' || hookId.length === 0) {
        return { success: false, error: 'Hook id is required' };
      }
      const deleted = await profileCacheManager.deleteHook(ctx.currentUserAlias, hookId);
      if (!deleted) return { success: false, error: 'Failed to delete hook' };
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  handle.getMasterSwitch(async () => {
    try {
      if (!ctx.currentUserAlias) return { success: false, enabled: false, error: 'No current user alias set' };
      return { success: true, enabled: profileCacheManager.isHooksEnabled(ctx.currentUserAlias) };
    } catch (error) {
      return { success: false, enabled: false, error: errorMessage(error) };
    }
  });

  handle.setMasterSwitch(async (_event, enabled) => {
    try {
      if (!ctx.currentUserAlias) return { success: false, error: 'No current user alias set' };
      if (typeof enabled !== 'boolean') return { success: false, error: 'enabled must be a boolean' };
      const saved = await profileCacheManager.setHooksEnabled(ctx.currentUserAlias, enabled);
      return saved ? { success: true } : { success: false, error: 'Failed to update Hooks master switch' };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  isRegistered = true;
  logger.info('[AgentHooks] IPC handlers registered');
}
