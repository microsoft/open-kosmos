import { BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import type { MemexManager } from '../../lib/memex/MemexManager';

export interface Context {
  _memexManager?: MemexManager;
  _schedulerInitPromise?: Promise<void>;
  _buddyInitPromise?: Promise<void>;
  currentUserAlias: string | null;
  readonly mainWindow: BrowserWindow | null;
  readonly debugWindow: BrowserWindow | null;
  readonly isDev: boolean;
  readonly isAnalyticsReady: boolean;
  readonly isAgentChatReady: boolean;
  readonly selectedText: string;

  readonly cleanupSelectionHook: () => void;
  readonly onBeforeQuit: (event: Electron.Event) => Promise<void>
  readonly registerGlobalShortcuts: () => Promise<void>;
  readonly getPersistedWindowZoomLevel: () => Promise<number>;
  readonly applyWindowZoomLevel: (level: number) => void;
  readonly stepWindowZoomLevel: (level: number) => void;
  readonly resetWindowZoomLevel: () => Promise<number>;
  readonly getMenuTemplate: () => Electron.MenuItemConstructorOptions[];
  readonly handleWebSearch: (chatId: string) => Promise<{ success: boolean; error?: string }>;
  readonly unregisterGlobalShortcuts: () => void;
  readonly createDebugWindow: () => Promise<void>;
  readonly checkAssetsLibrariesAsync: () => Promise<void>;
}


export type ImportConflictResolution = 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';

export interface PlannedImportItem {
  id: string;
  finalPath?: string;
  replaceExisting?: boolean;
  skipped?: boolean;
  renamed?: boolean;
}

export interface ImportConflictItem {
  id: string;
  displayName: string;
  desiredPath: string;
  reason: 'already-exists' | 'duplicate-selection';
}

export const getConflictPromptWindow = (event: Electron.IpcMainInvokeEvent) => {
  return BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
};

export const getUniqueImportPath = (targetPath: string, reservedPaths: Set<string>): string => {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);

  let counter = 1;
  let candidatePath = targetPath;
  while (reservedPaths.has(candidatePath) || fs.existsSync(candidatePath)) {
    candidatePath = path.join(directory, `${baseName} (${counter})${extension}`);
    counter += 1;
  }

  return candidatePath;
};

export const collectImportConflicts = (
  candidates: Array<{ id: string; displayName: string; desiredPath: string }>,
): ImportConflictItem[] => {
  const reservedDesiredPaths = new Set<string>();
  const conflicts: ImportConflictItem[] = [];

  for (const candidate of candidates) {
    const alreadyExists = fs.existsSync(candidate.desiredPath);
    const duplicateSelection = reservedDesiredPaths.has(candidate.desiredPath);

    if (alreadyExists || duplicateSelection) {
      conflicts.push({
        id: candidate.id,
        displayName: candidate.displayName,
        desiredPath: candidate.desiredPath,
        reason: alreadyExists ? 'already-exists' : 'duplicate-selection',
      });
    }

    reservedDesiredPaths.add(candidate.desiredPath);
  }

  return conflicts;
};

export const planImportTargets = (
  candidates: Array<{ id: string; desiredPath: string }>,
  strategy: Exclude<ImportConflictResolution, 'prompt' | 'reject'>,
): PlannedImportItem[] => {
  const reservedFinalPaths = new Set<string>();
  const plans: PlannedImportItem[] = [];

  for (const candidate of candidates) {
    const desiredPath = candidate.desiredPath;
    const alreadyExists = fs.existsSync(desiredPath);
    const duplicateSelection = reservedFinalPaths.has(desiredPath);

    if (!alreadyExists && !duplicateSelection) {
      reservedFinalPaths.add(desiredPath);
      plans.push({
        id: candidate.id,
        finalPath: desiredPath,
      });
      continue;
    }

    if (strategy === 'skip') {
      plans.push({ id: candidate.id, skipped: true });
      continue;
    }

    if (strategy === 'replace' && !duplicateSelection) {
      reservedFinalPaths.add(desiredPath);
      plans.push({
        id: candidate.id,
        finalPath: desiredPath,
        replaceExisting: alreadyExists,
      });
      continue;
    }

    const finalPath = getUniqueImportPath(desiredPath, reservedFinalPaths);
    reservedFinalPaths.add(finalPath);
    plans.push({
      id: candidate.id,
      finalPath,
      renamed: finalPath !== desiredPath,
    });
  }

  return plans;
};

export const promptImportConflictResolution = async (
  event: Electron.IpcMainInvokeEvent,
  actionLabel: string,
  conflicts: ImportConflictItem[],
): Promise<'replace' | 'keep-both' | 'skip' | 'cancel'> => {
  const previewItems = conflicts.slice(0, 10).map((conflict) => {
    const reasonLabel = conflict.reason === 'already-exists'
      ? 'already exists'
      : 'duplicate in this import';
    return `• ${conflict.displayName} (${reasonLabel})`;
  });

  if (conflicts.length > 10) {
    previewItems.push(`• ${conflicts.length - 10} more conflicts not shown`);
  }

  const detail = [
    `${conflicts.length} conflicting item${conflicts.length === 1 ? '' : 's'} were found while trying to ${actionLabel}.`,
    '',
    ...previewItems,
    '',
    'Choose how to handle the conflicting items.',
    'Replace all: overwrite existing items. Duplicate names within this import are kept with new names.',
    'Keep both: keep existing items and rename the new conflicting ones.',
    'Skip conflicting files: only skip the conflicting items.',
  ].join('\n');

  const dialogOptions: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Conflicting Files Found',
    message: 'Conflicting files found',
    detail,
    buttons: ['Cancel', 'Skip conflicting files', 'Keep both', 'Replace all'],
    cancelId: 0,
    defaultId: 2,
    noLink: true,
  };

  const browserWindow = getConflictPromptWindow(event);
  const result = browserWindow
    ? await dialog.showMessageBox(browserWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);

  switch (result.response) {
    case 1:
      return 'skip';
    case 2:
      return 'keep-both';
    case 3:
      return 'replace';
    default:
      return 'cancel';
  }
};