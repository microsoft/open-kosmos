/**
 * embeddedBrowserIPC — type-safe IPC bridge for the in-app browser side panel.
 * Delegates everything to EmbeddedBrowserManager.
 */

import { ipcMain } from 'electron';
import { type EmbeddedBrowserBounds, renderToMain } from '@shared/ipc/embeddedBrowser';
import { EmbeddedBrowserManager } from './EmbeddedBrowserManager';
import { profileCacheManager } from '../userDataADO/profileCacheManager';

export function registerEmbeddedBrowserIPC(manager: EmbeddedBrowserManager): void {
  const handle = renderToMain.bindMain(ipcMain);
  const requireEnabled = () => {
    const alias = profileCacheManager.getCurrentUserAlias();
    if (!alias || profileCacheManager.getBrowserSettings(alias).enabled !== true) {
      throw new Error('Embedded browser is disabled (enable it in Settings -> Browser).');
    }
  };

  handle.open(async (_e, sessionId, url) => { requireEnabled(); return manager.open(requireSessionId(sessionId), requireWebUrl(url)); });
  handle.navigate(async (_e, sessionId, url) => { requireEnabled(); return manager.navigate(requireSessionId(sessionId), requireWebUrl(url)); });
  handle.show(async (_e, sessionId) => { requireEnabled(); return manager.show(requireSessionId(sessionId)); });
  handle.hide(async (_e, sessionId) => { requireEnabled(); return manager.hide(requireSessionId(sessionId)); });
  handle.setBounds(async (_e, sessionId, bounds) => { requireEnabled(); return manager.setBounds(requireSessionId(sessionId), requireBounds(bounds)); });
  handle.goBack(async (_e, sessionId) => { requireEnabled(); return manager.goBack(requireSessionId(sessionId)); });
  handle.goForward(async (_e, sessionId) => { requireEnabled(); return manager.goForward(requireSessionId(sessionId)); });
  handle.reload(async (_e, sessionId) => { requireEnabled(); return manager.reload(requireSessionId(sessionId)); });
  handle.stop(async (_e, sessionId) => { requireEnabled(); return manager.stop(requireSessionId(sessionId)); });
  handle.setActiveSession(async (_e, sessionId) => manager.setActiveSession(sessionId === null ? null : requireSessionId(sessionId)));
  handle.destroyAll(async () => manager.destroyAll());
}

function requireSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Embedded browser IPC requires a non-empty sessionId.');
  }
  return value;
}

function requireWebUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Embedded browser IPC requires a URL string.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Embedded browser IPC requires a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Embedded browser IPC only accepts http and https URLs.');
  }
  return value;
}

function requireBounds(value: unknown): EmbeddedBrowserBounds {
  const bounds = value as Partial<EmbeddedBrowserBounds> | null;
  const values = [bounds?.x, bounds?.y, bounds?.width, bounds?.height];
  if (!bounds || values.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
    throw new Error('Embedded browser IPC requires finite non-negative bounds.');
  }
  return bounds as EmbeddedBrowserBounds;
}
