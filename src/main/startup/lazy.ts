import { app } from 'electron';
import * as path from 'path';

import type { ProfileCacheManager } from '../lib/userDataADO/profileCacheManager';
import type { AppCacheManager } from '../lib/userDataADO/appCacheManager';
import type { MainAuthManager } from '../lib/auth/authManager';
import type { TerminalManager } from '../lib/terminalManager';
import type { ExternalAgentService } from '../lib/externalAgent/externalAgentService';

import { createLogger, UnifiedLogger } from '../lib/unifiedLogger';

import { profileCacheManager } from '../lib/userDataADO';
import { appCacheManager } from '../lib/userDataADO/appCacheManager';
import { mainAuthManager } from '../lib/auth/authManager';
import { MainTokenMonitor } from '../lib/auth/tokenMonitor';
import { getTerminalManager } from '../lib/terminalManager';

// 🚀 Lazily loaded module cache
let _profileCacheManager: ProfileCacheManager | null = null;
let _appCacheManager: AppCacheManager | null = null;
let _mainAuthManager: MainAuthManager | null = null;
let _mainTokenMonitor: MainTokenMonitor | null = null;
let _terminalManager: TerminalManager | null = null;
let _externalAgentService: ExternalAgentService | null = null;

// 🚀 Lazy getters: modules loaded only on first call
export async function getProfileCacheManager(): Promise<ProfileCacheManager> {
  if (!_profileCacheManager) {
    _profileCacheManager = profileCacheManager;
  }
  return _profileCacheManager;
}

export async function getAppCacheManager(): Promise<AppCacheManager> {
  if (!_appCacheManager) {
    _appCacheManager = appCacheManager;
    // Initialize immediately on first load (read and migrate app.json)
    await _appCacheManager.initialize();
  }
  return _appCacheManager;
}


export async function getMainAuthManager(): Promise<MainAuthManager> {
  if (!_mainAuthManager) {
    _mainAuthManager = mainAuthManager;
  }
  return _mainAuthManager;
}

export async function getMainTokenMonitor(): Promise<MainTokenMonitor> {
  if (!_mainTokenMonitor) {
    _mainTokenMonitor = MainTokenMonitor.getInstance();
  }
  return _mainTokenMonitor;
}

export async function getTerminalManagerInstance(): Promise<TerminalManager> {
  if (!_terminalManager) {
    _terminalManager = getTerminalManager();
  }
  return _terminalManager;
}

export async function getExternalAgentService(alias: string): Promise<ExternalAgentService> {
  if (!_externalAgentService) {
    const { initExternalAgentModule } = await import('../lib/externalAgent');
    _externalAgentService = await initExternalAgentModule(alias);
  }
  return _externalAgentService;
}

export function useExternalAgentService<T>(callback: (service: ExternalAgentService) => T) {
  if (!_externalAgentService) return;
  return callback(_externalAgentService);
}

export async function resetExternalAgentService(): Promise<void> {
  if (_externalAgentService) {
    await _externalAgentService.stop();
    _externalAgentService = null;
  }
}

// 🚀 Synchronous getters (for fast access after initialization)
export function getProfileCacheManagerSync(): ProfileCacheManager | null {
  return _profileCacheManager;
}


// 🚀 Optimization: lazy Logger initialization, created on first use
let advancedLogger: UnifiedLogger | null = null;

// Lazily get Logger instance
export const getAdvancedLogger = () => {
  if (!advancedLogger) {
    const logDirectory = path.join(app.getPath('userData'), 'logs');
    advancedLogger = createLogger({ LOGGER_DIRECTORY: logDirectory });
  }
  return advancedLogger;
};

export function useAdvancedLogger<T>(callback: (logger: UnifiedLogger) => T) {
  if (!advancedLogger) return;
  return callback(advancedLogger);
}
