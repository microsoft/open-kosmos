export interface AuthUiWindowCandidate {
  isDestroyed(): boolean;
  webContents?: {
    send(channel: string, data: unknown): void;
    getURL?(): string;
  };
  getParentWindow?(): unknown;
  getTitle?(): string;
}

function getWindowUrl(window: AuthUiWindowCandidate): string {
  try {
    return window.webContents?.getURL?.() ?? '';
  } catch {
    return '';
  }
}

function getWindowTitle(window: AuthUiWindowCandidate): string {
  try {
    return window.getTitle?.() ?? '';
  } catch {
    return '';
  }
}

function hasParentWindow(window: AuthUiWindowCandidate): boolean {
  try {
    return !!window.getParentWindow?.();
  } catch {
    return false;
  }
}

function isUsableWindow(window: AuthUiWindowCandidate): boolean {
  return !window.isDestroyed() && !!window.webContents;
}

export function isPrimaryAuthUiWindow(window: AuthUiWindowCandidate): boolean {
  if (!isUsableWindow(window)) {
    return false;
  }

  const url = getWindowUrl(window);
  const title = getWindowTitle(window);

  if (hasParentWindow(window)) {
    return false;
  }

  if (url.includes('screenshot.html') || url.includes('/screenshot')) {
    return false;
  }

  if (/debug tools/i.test(title)) {
    return false;
  }

  return true;
}

export function pickAuthUiWindow<T extends AuthUiWindowCandidate>(windows: T[]): T | null {
  return windows.find(isPrimaryAuthUiWindow) ?? windows.find(isUsableWindow) ?? null;
}
