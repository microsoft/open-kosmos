import { ipcMain, BrowserWindow } from 'electron';
import { renderToMain, mainToRender } from '@shared/ipc/buddy';
import { BuddyManager } from './BuddyManager';
import { generateReaction } from './reactionEngine';

let isRegistered = false;

export const registerBuddyIPC = (): void => {
  if (isRegistered) return;

  const handle = renderToMain.bindMain(ipcMain);
  const manager = BuddyManager.getInstance();

  // Helper to broadcast to all windows
  function broadcast(eventName: string, payload: any): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        const sender = mainToRender.bindWebContents(win.webContents);
        (sender as any)[eventName](payload);
      }
    }
  }

  // Register event listener so addXP (called from agentChat) pushes updates to renderer
  manager.setEventListener({
    onXPUpdated: (data) => broadcast('xp-updated', data),
    onLevelUp: (data) => broadcast('level-up', data),
    onMilestone: (data) => broadcast('milestone', data),
  });

  handle.getCompanion(async () => {
    try {
      const companion = manager.getCompanion();
      return { success: true, data: companion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.hatchCompanion(async () => {
    try {
      const companion = manager.hatch();
      return { success: true, data: companion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.renameCompanion(async (_event, name) => {
    try {
      const companion = manager.rename(name);
      return { success: true, data: companion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.petCompanion(async () => {
    try {
      const petAt = manager.pet();
      return { success: true, data: { petAt } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.getXPData(async () => {
    try {
      const data = manager.getXPData();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.setMuted(async (_event, muted) => {
    try {
      manager.setMuted(muted);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.triggerReaction(async (_event, lastUserMsg, lastAssistantMsg) => {
    try {
      const companion = manager.getCompanion();
      if (!companion || manager.isMuted()) {
        return { success: true, data: null };
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const callLLM = async (_prompt: string): Promise<string> => {
        // TODO: Wire to actual lightweight model call in integration
        return '';
      };

      const result = await generateReaction(
        companion,
        lastUserMsg,
        lastAssistantMsg,
        manager.getLastReactionTime(),
        callLLM,
      );

      if (result) {
        manager.setLastReactionTime(Date.now());
      }

      return { success: true, data: result ?? null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.getRoster(async () => {
    try {
      const data = manager.getRoster();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.setActiveBuddy(async (_event, buddyId) => {
    try {
      const companion = manager.setActiveBuddy(buddyId);
      broadcast('companion-updated', companion);
      return { success: true, data: companion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.mergeBuddies(async (_event, keepId, deleteId) => {
    try {
      const result = manager.mergeBuddies(keepId, deleteId);
      broadcast('rarity-upgraded', {
        buddyId: result.updatedBuddy.id,
        newRarity: result.newRarity,
      });
      return { success: true, data: { buddy: result.updatedBuddy, newRarity: result.newRarity } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.releaseBuddy(async (_event, buddyId) => {
    try {
      manager.releaseBuddy(buddyId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  isRegistered = true;
};
