import { useState, useEffect } from 'react';
import { appDataManager } from '../userData/appDataManager';

const isMac = navigator.platform.toUpperCase().includes('MAC');

/** Electron accelerator → display symbol */
function formatShortcut(shortcut: string): string {
  const parts = shortcut.split('+');
  return parts
    .map((part) => {
      const key = part.trim();
      const lower = key.toLowerCase();
      if (lower === 'commandorcontrol' || lower === 'cmdorctrl') return isMac ? '⌘' : 'Ctrl';
      if (lower === 'command' || lower === 'cmd') return '⌘';
      if (lower === 'control' || lower === 'ctrl') return isMac ? '⌃' : 'Ctrl';
      if (lower === 'shift') return isMac ? '⇧' : 'Shift';
      if (lower === 'alt' || lower === 'option') return isMac ? '⌥' : 'Alt';
      if (lower === 'super' || lower === 'meta') return isMac ? '⌘' : 'Win';
      return key.toUpperCase();
    })
    .join(isMac ? '' : '+');
}

/**
 * Returns a human-readable string for the current screenshot hotkey, e.g. "⌘⇧S" (macOS) or "Ctrl+Shift+S" (Windows).
 * Returns undefined when screenshot is not enabled.
 */
export function useScreenshotHotkey(): string | undefined {
  const [hotkey, setHotkey] = useState<string | undefined>(() => {
    const settings = appDataManager.getConfig().screenshotSettings;
    if (!settings?.enabled || !settings.shortcut) return undefined;
    if (!settings.shortcutEnabled) return undefined;
    return formatShortcut(settings.shortcut);
  });

  useEffect(() => {
    const check = (config: ReturnType<typeof appDataManager.getConfig>) => {
      const settings = config.screenshotSettings;
      if (!settings?.enabled || !settings.shortcut || !settings.shortcutEnabled) {
        setHotkey(undefined);
      } else {
        setHotkey(formatShortcut(settings.shortcut));
      }
    };

    check(appDataManager.getConfig());
    const unsub = appDataManager.subscribe(check);
    return unsub;
  }, []);

  return hotkey;
}
