import { ipcMain } from 'electron';

import { getMainAuthManager } from '../lazy';
import type { Context } from './shared';

export default function(ctx: Context) {
  ipcMain.handle('signin:getValidUsersForSignin', async () => {
    try {
      const authManager = await getMainAuthManager();
      const userValidation = await authManager.getValidAuthsForSignin();
      return { success: true, data: userValidation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Auth management handlers - AUTHORIZED
  ipcMain.handle('signin:clearTokens', async (event, alias: string) => {
    try {
      const authManager = await getMainAuthManager();
      const success = await authManager.clearAuthTokens(alias);
      if (success) {
        // Clear current user alias if this is the currently logged-in user
        if (ctx.currentUserAlias === alias) {
          ctx.currentUserAlias = null;
        }
      } else {
      }
      return { success, error: success ? undefined : 'Failed to clear auth tokens' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('signin:clearAuthData', async (event, alias: string) => {
    try {
      const authManager = await getMainAuthManager();
      const success = await authManager.deleteAuthJson(alias);
      if (success) {
        // Clear current user alias if this is the currently logged-in user
        if (ctx.currentUserAlias === alias) {
          ctx.currentUserAlias = null;
        }
      }
      return { success, error: success ? undefined : 'Failed to clear auth.json file' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('signin:updateAuthData', async (event, alias: string, authData: any) => {
    try {
      const authManager = await getMainAuthManager();
      const success = await authManager.updateAuthJson(alias, authData);
      return { success, error: success ? undefined : 'Failed to update auth data' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('signin:updateAuthJson', async (event, alias: string, authData: any) => {
    try {
      const authManager = await getMainAuthManager();
      const success = await authManager.updateAuthJson(alias, authData);
      return { success, error: success ? undefined : 'Failed to update auth.json' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  // Profile scanning handler (uses SigninOps internally) - AUTHORIZED
  ipcMain.handle('signin:getProfilesWithGhcAuth', async () => {
    try {
      const authManager = await getMainAuthManager();
      const profilesWithAuth = await authManager.getProfilesWithAuth();
      return { success: true, data: profilesWithAuth };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

