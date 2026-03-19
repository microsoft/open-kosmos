import { globalShortcut } from 'electron';
import { ScreenshotManager } from './ScreenshotManager';
import { isFeatureEnabled } from '../featureFlags';

let currentShortcut: string | null = null;

export interface ScreenshotShortcutOptions {
  getCurrentUserAlias: () => string | null;
}

export function unregisterScreenshotShortcut(): void {
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut);
    currentShortcut = null;
  }
}

export async function registerScreenshotShortcut(options: ScreenshotShortcutOptions): Promise<void> {
  unregisterScreenshotShortcut();

  if (!isFeatureEnabled('kosmosFeatureScreenshot')) {
    return;
  }

  const { appCacheManager } = await import('../userDataADO');
  const settings = appCacheManager.getScreenshotSettings();
  if (!settings.enabled) {
    return;
  }

  // Do not register if the shortcut is not enabled
  if (!settings.shortcutEnabled) {
    return;
  }

  const shortcut = settings.shortcut || 'CommandOrControl+Shift+S';
  globalShortcut.register(shortcut, () => {
    ScreenshotManager.getInstance().capture(false);
  });
  currentShortcut = shortcut;
  const registered = globalShortcut.isRegistered(shortcut);
}
