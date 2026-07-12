/**
 * memexIPC — IPC bridge for Memex Memory surfaces.
 *
 * The chat sidepane reads current-agent memory. Settings reads profile-memory
 * and can archive/delete cards. Agent-facing create/edit mutations still go
 * through the `memex_memory` built-in tool (main process, see
 * builtinTools/memexMemoryTool.ts).
 *
 * Alias is resolved per-call from the live session (ctx.currentUserAlias); chatId
 * is supplied by the renderer and resolved to the current primary agent id in the
 * main process. No install/enable/disable lifecycle — the memory tree is lazily
 * created on first write.
 */

import { ipcMain, app, BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { renderToMain, mainToRender, type MemexResult } from '@shared/ipc/memex';
import type { MemexMemoryScope, MemexMemoryTarget } from '@shared/types/memexTypes';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getChatAgentIds } from '../userDataADO/agentAccessor';
import { createConsoleLogger } from '../unifiedLogger';
import { memexService } from './MemexService';
import { buildAgentMemexHome, buildProfileMemexHome, type MemexHome } from './memexHome';
import { emitCardsChanged, memexEvents, MEMEX_CARDS_CHANGED, type MemexCardsChangedPayload } from './memexEvents';

const MEMEX_DISABLED_ERROR = 'Memex Memory feature is disabled';
const logger = createConsoleLogger();

interface MemexIPCContext {
  /** Live session alias; read per-call so it always reflects the signed-in user. */
  currentUserAlias: string | null;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Resolve a memory home for a request, or return a typed error.
 * Guards the app-level master switch, the session alias, and a non-empty chatId.
 */
async function resolveHome(
  ctx: MemexIPCContext,
  rawTarget: MemexMemoryTarget | string,
): Promise<{ home: MemexHome; scope: MemexMemoryScope; userAlias: string; agentId?: string; chatId?: string } | { error: string }> {
  const alias = ctx.currentUserAlias;
  if (!alias) return { error: 'No signed-in user; cannot resolve memory.' };
  if (!profileCacheManager.getMemexSettings(alias).enabled) {
    return { error: MEMEX_DISABLED_ERROR };
  }
  const target = normalizeTarget(rawTarget);
  if (!target) return { error: 'Invalid memory target.' };
  if (target.scope === 'profile-memory') {
    try {
      return { scope: 'profile-memory', userAlias: alias, home: buildProfileMemexHome(app.getPath('userData'), alias) };
    } catch (e) {
      return { error: `Failed to open memory: ${errMsg(e)}` };
    }
  }
  const chatId = target.chatId;
  if (!chatId) return { error: 'chatId is required.' };
  try {
    const chat = profileCacheManager.getChatConfig(alias, chatId);
    const agentId = getChatAgentIds(chat)[0];
    if (!agentId) return { error: 'No primary agent is bound to this chat; cannot resolve memory.' };
    const home = buildAgentMemexHome(app.getPath('userData'), alias, agentId);
    return { home, scope: 'current-agent', userAlias: alias, agentId, chatId };
  } catch (e) {
    return { error: `Failed to open memory: ${errMsg(e)}` };
  }
}

function normalizeTarget(target: MemexMemoryTarget | string): MemexMemoryTarget | null {
  if (typeof target === 'string') {
    return { scope: 'current-agent', chatId: target };
  }
  if (!target || typeof target !== 'object') return null;
  if (target.scope === 'profile-memory') return { scope: 'profile-memory' };
  if (target.scope === 'current-agent') return { scope: 'current-agent', chatId: target.chatId };
  return null;
}

function profileMemoryTarget(): MemexMemoryTarget {
  return { scope: 'profile-memory' };
}

function chatIdsForAgent(userAlias: string, agentId: string, fallbackChatId?: string): string[] {
  try {
    const chats = profileCacheManager.getAllChatConfigs(userAlias);
    const matches = chats
      .filter((chat) => getChatAgentIds(chat).includes(agentId))
      .map((chat) => chat.chat_id)
      .filter((chatId): chatId is string => typeof chatId === 'string' && chatId.length > 0);
    if (matches.length > 0) return matches;
  } catch (e) {
    logger.warn('[memexIPC] Failed to fan out cardsChanged event', 'chatIdsForAgent', {
      reason: errMsg(e),
    });
  }
  return fallbackChatId ? [fallbackChatId] : [];
}

export function registerMemexIPC(ctx: MemexIPCContext): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.listCards(async (_event, target): Promise<MemexResult<Awaited<ReturnType<typeof memexService.listCards>>>> => {
    const resolved = await resolveHome(ctx, target);
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      return { success: true, data: await memexService.listCards(resolved.home) };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  handle.readCard(async (_event, target, slug): Promise<MemexResult<Awaited<ReturnType<typeof memexService.readCardStructured>>>> => {
    const resolved = await resolveHome(ctx, target);
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      return { success: true, data: await memexService.readCardStructured(resolved.home, slug) };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  handle.getGraph(async (_event, target): Promise<MemexResult<Awaited<ReturnType<typeof memexService.getGraph>>>> => {
    const resolved = await resolveHome(ctx, target);
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      return { success: true, data: await memexService.getGraph(resolved.home) };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  handle.searchCards(async (_event, target, query): Promise<MemexResult<Awaited<ReturnType<typeof memexService.searchCards>>>> => {
    const resolved = await resolveHome(ctx, target);
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      return { success: true, data: await memexService.searchCards(resolved.home, query) };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  handle.archiveProfileCard(async (_event, slug): Promise<MemexResult<string>> => {
    const resolved = await resolveHome(ctx, profileMemoryTarget());
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      const output = await memexService.archive(resolved.home, slug);
      emitCardsChanged({ userAlias: resolved.userAlias, scope: 'profile-memory' });
      return { success: true, data: output };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  handle.deleteProfileCard(async (_event, slug): Promise<MemexResult<string>> => {
    const resolved = await resolveHome(ctx, profileMemoryTarget());
    if ('error' in resolved) return { success: false, error: resolved.error };
    try {
      const output = await memexService.delete(resolved.home, slug);
      emitCardsChanged({ userAlias: resolved.userAlias, scope: 'profile-memory' });
      return { success: true, data: output };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });
}

/** Forward process-local card-change events to every open window's sidepane. */
function subscribeCardsChanged(): void {
  memexEvents.on(MEMEX_CARDS_CHANGED, (payload: MemexCardsChangedPayload) => {
    if (payload.scope === 'profile-memory') {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        mainToRender.bindWebContents(win.webContents).cardsChanged({ scope: 'profile-memory' });
      }
      return;
    }
    if (!payload.agentId) return;
    const chatIds = chatIdsForAgent(payload.userAlias, payload.agentId, payload.chatId);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const bridge = mainToRender.bindWebContents(win.webContents);
      for (const chatId of chatIds) {
        bridge.cardsChanged({ scope: 'current-agent', chatId, agentId: payload.agentId });
      }
    }
  });
}

let isWired = false;

/**
 * One-call setup: register the read IPC handlers and subscribe to the write-path
 * event bus. Always registers (like the embedded browser): each read handler
 * gates on the per-profile master switch per-call via `resolveHome`, so toggling
 * the switch at runtime takes effect without re-wiring. Idempotent via `isWired`.
 */
export function setupMemex(ctx: {
  currentUserAlias: string | null;
  mainWindow: BrowserWindowType | null;
}): void {
  if (isWired) return;
  registerMemexIPC(ctx);
  subscribeCardsChanged();
  isWired = true;
}
