import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ProfileCacheManager } from '../userDataADO/profileCacheManager';
import type { TerminalManager } from '../terminalManager';
import { createLogger } from '../unifiedLogger';
import { getOrCreateInstallationDeviceId } from '../utilities/idFactory';
import { agentChatManager } from "../chat/agentChatManager";
import { agentIdOf, getChatAgents, getChatPrimaryAgent } from '../userDataADO/agentAccessor';
import { getAgentKnowledgeDir, isSafeAgentId } from '../userDataADO/agentStoreManager';
import type { ChatAgent } from '../userDataADO/types/profile';

export interface SyncIPCDeps {
  getProfileCacheManager: () => Promise<ProfileCacheManager>;
  getTerminalManager: () => Promise<TerminalManager>;
  getCurrentAlias: () => string;
}

interface ExternalKnowledgeBaseItem {
  chatId: string;
  agentId: string;
  agentName: string;
  knowledgeBase: string;
}

interface CopyKnowledgeBaseItem {
  chatId: string;
  agentId: string;
  knowledgeBase: string;
}

export function registerSyncIPC(deps: SyncIPCDeps): void {
  const { getProfileCacheManager, getTerminalManager, getCurrentAlias } = deps;

  // ── Helpers ──

  const getSyncSettings = async () => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      return profileManager.getSyncSettings(alias);
    } catch {
      return { enabled: false, repoUrl: '', lastSyncTime: null };
    }
  };

  const runGitCommand = async (
    command: string,
    profileDir: string,
    timeoutMs: number = 30000
  ): Promise<{ success: boolean; stdout: string; error?: string }> => {
    const terminalManager = await getTerminalManager();
    const result = await terminalManager.executeCommand({
      command,
      args: [],
      cwd: profileDir,
      type: 'command',
      timeoutMs,
      persistent: false
    });
    if (result.exitCode !== 0) {
      return { success: false, stdout: '', error: result.stderr || `Command failed: ${command}` };
    }
    return { success: true, stdout: result.stdout };
  };

  function parseGitPullError(errorMsg: string): string {
    if (errorMsg.includes('Could not resolve host')) {
      return 'Network error: Unable to connect to GitHub. Please check your internet connection.';
    }
    if (errorMsg.includes('Authentication failed') || errorMsg.includes('could not read Username')) {
      return 'Authentication failed. Please check your GitHub credentials.';
    }
    if (errorMsg.includes('CONFLICT') || errorMsg.includes('Merge conflict')) {
      return 'Merge conflict detected. Use "Force Pull" to overwrite local changes with remote.';
    }
    if (errorMsg.includes("couldn't find remote ref")) {
      return 'Remote branch not found. The repository may be empty or the branch does not exist.';
    }
    if (errorMsg.includes('unrelated histories')) {
      return 'Local and remote have different histories. Use "Force Pull" to replace local with remote data.';
    }
    if (errorMsg.includes('untracked working tree files would be overwritten')) {
      return 'Local files would be overwritten by pull. Use "Force Pull" to replace local with remote data.';
    }
    if (errorMsg.includes('local changes to the following files would be overwritten')) {
      return 'Local changes would be overwritten by pull. Use "Force Pull" to replace local with remote data.';
    }
    return errorMsg;
  }

  function parseGitPushError(errorMsg: string): string {
    if (errorMsg.includes('Could not resolve host')) {
      return 'Network error: Unable to connect to GitHub. Please check your internet connection.';
    }
    if (errorMsg.includes('Authentication failed') || errorMsg.includes('could not read Username')) {
      return 'Authentication failed. Please check your GitHub credentials.';
    }
    if (errorMsg.includes('rejected') && errorMsg.includes('fetch first')) {
      return 'Remote has newer changes. Pull first, or use "Force Push" to overwrite remote.';
    }
    if (errorMsg.includes('rejected') && errorMsg.includes('non-fast-forward')) {
      return 'Push rejected: Remote history has diverged. Pull first, or use "Force Push" to overwrite.';
    }
    if (errorMsg.includes('does not have a commit checked out')) {
      return 'Repository not properly initialized. Try disabling and re-enabling sync.';
    }
    if (errorMsg.includes('src refspec') && errorMsg.includes('does not match any')) {
      return 'No commits to push. Make some changes first, or pull from remote if the repository already has data.';
    }
    return errorMsg;
  }

  function isPathInsideOrEqual(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }

  /** Build a commit-message timestamp string with timezone offset and device id */
  function buildCommitMessage(): string {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const mm = String(Math.abs(offset) % 60).padStart(2, '0');
    const deviceId = getOrCreateInstallationDeviceId();
    return now.toISOString().slice(0, 19).replace('T', ' ') + ` ${sign}${hh}${mm} [${deviceId}]`;
  }

  /** Get current git branch name */
  async function getCurrentBranch(profileDir: string): Promise<string> {
    const r = await runGitCommand('git rev-parse --abbrev-ref HEAD', profileDir);
    return r.success ? r.stdout.trim() : 'main';
  }

  /** Backup profile directory (excluding .git) before destructive sync operations */
  function backupProfile(profileDir: string, alias: string) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(app.getPath('userData'), 'profiles', `.${alias}_backup_${ts}`);
    try {
      fs.cpSync(profileDir, backupDir, {
        recursive: true,
        filter: (src) => !src.includes('.git')
      });
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`attrib +h "${backupDir}"`);
      }
    } catch (backupError) {
      createLogger().warn(`[Sync] Failed to create backup: ${backupError}`);
    }
  }

  /** Reload caches / notify frontend after a sync operation */
  async function reloadAfterSync(alias: string) {
    const profileManager = await getProfileCacheManager();

    // 1. Destroy old agent state first — disposal notifications clear stale UI entries
    await agentChatManager.destroy(true);

    // 2. Clear profile cache so reads pick up the merged data from disk
    profileManager.clearCache(alias);

    // 3. Update sync timestamp (reads merged profile, caches it, writes back)
    await profileManager.updateSyncSettings(alias, { lastSyncTime: new Date().toISOString() });

    // 4. Re-initialize agent manager
    await agentChatManager.initialize(alias);

    // 5. Send profile notification LAST — frontend receives the definitive state
    //    after all disposals are done, so no disposal events can override it
    await profileManager.forceNotifyProfileDataManager(alias);
  }

  // ── IPC Handlers ──

  ipcMain.handle('sync:getSettings', async () => {
    return getSyncSettings();
  });

  ipcMain.handle('sync:setEnabled', async (_event, enabled: boolean) => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const updated = await profileManager.updateSyncSettings(alias, { enabled });
      if (!updated) {
        return { success: false, error: 'Failed to update sync settings. Profile may not exist.' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sync:setRepoUrl', async (_event, url: string) => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const updated = await profileManager.updateSyncSettings(alias, { repoUrl: url });
      if (!updated) {
        return { success: false, error: 'Failed to update sync settings. Profile may not exist.' };
      }

      // Update git remote URL if repo is already initialized
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);
      if (fs.existsSync(path.join(profileDir, '.git'))) {
        const result = await runGitCommand(`git remote set-url origin ${url}`, profileDir);
        if (!result.success) {
          if (result.error?.includes('No such remote')) {
            await runGitCommand(`git remote add origin ${url}`, profileDir);
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sync:validateRepoUrl', async (_event, url: string) => {
    try {
      if (!url) {
        return { success: false, error: 'Repository URL is required' };
      }

      const result = await runGitCommand(`git ls-remote ${url}`, app.getPath('userData'));

      if (!result.success) {
        const errorMsg = result.error || '';
        if (errorMsg.includes('Could not resolve host')) {
          return { success: false, error: 'Network error: Unable to connect to GitHub. Please check your internet connection.' };
        }
        if (errorMsg.includes('Authentication failed') || errorMsg.includes('could not read Username')) {
          return { success: false, error: 'Authentication failed. Please check your GitHub credentials.' };
        }
        if (errorMsg.includes('not found') || errorMsg.includes('Repository not found')) {
          return { success: false, error: 'Repository not found. Please check the URL and ensure you have access.' };
        }
        return { success: false, error: 'Repository not accessible. Please verify the URL and your permissions.' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sync:getStatus', async (_event, checkChanges: boolean = true) => {
    try {
      const settings = await getSyncSettings();
      if (!settings.repoUrl) {
        return null;
      }

      const profileDir = path.join(app.getPath('userData'), 'profiles', getCurrentAlias());
      const isInitialized = fs.existsSync(path.join(profileDir, '.git'));

      if (!isInitialized) {
        return { hasLocalChanges: null, hasRemoteChanges: null, isInitialized: false, currentBranch: null };
      }

      let currentBranch: string | null = null;
      const branchResult = await runGitCommand('git rev-parse --abbrev-ref HEAD', profileDir);
      if (branchResult.success) {
        currentBranch = branchResult.stdout.trim();
      }

      if (!checkChanges) {
        return { hasLocalChanges: null, hasRemoteChanges: null, isInitialized: true, currentBranch };
      }

      let hasLocalChanges = false;
      const statusResult = await runGitCommand('git status --porcelain', profileDir);
      if (statusResult.success) {
        hasLocalChanges = statusResult.stdout.trim().length > 0;
      }

      let hasRemoteChanges = true;
      if (currentBranch) {
        await runGitCommand('git fetch origin', profileDir);
        const remoteCheckResult = await runGitCommand(`git rev-list HEAD..origin/${currentBranch} --count`, profileDir);
        if (remoteCheckResult.success) {
          hasRemoteChanges = parseInt(remoteCheckResult.stdout.trim(), 10) > 0;
        }
      }

      return { hasLocalChanges, hasRemoteChanges, isInitialized: true, currentBranch };
    } catch {
      return null;
    }
  });

  ipcMain.handle('sync:initialize', async () => {
    try {
      const settings = await getSyncSettings();
      if (!settings.repoUrl) {
        return { success: false, error: 'Repository URL not configured' };
      }

      const profileDir = path.join(app.getPath('userData'), 'profiles', getCurrentAlias());

      if (!fs.existsSync(profileDir)) {
        return { success: false, error: 'Profile directory does not exist' };
      }

      if (!fs.existsSync(path.join(profileDir, '.git'))) {
        let gitResult = await runGitCommand('git init', profileDir);
        if (!gitResult.success) return { success: false, error: gitResult.error };

        gitResult = await runGitCommand('git branch -M main', profileDir);
        if (!gitResult.success) return { success: false, error: gitResult.error };

        gitResult = await runGitCommand(`git remote add origin ${settings.repoUrl}`, profileDir);
        if (!gitResult.success) return { success: false, error: gitResult.error };

        const gitignorePath = path.join(profileDir, '.gitignore');
        const gitignoreContent = '# Sensitive files - do not sync\nauth.json\n';
        fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sync:pull', async (_event, force: boolean) => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);

      if (!fs.existsSync(path.join(profileDir, '.git'))) {
        return { success: false, error: 'Sync repository not initialized' };
      }

      const currentBranch = await getCurrentBranch(profileDir);

      if (!force) {
        const statusResult = await runGitCommand('git status --porcelain', profileDir);
        if (statusResult.success && statusResult.stdout.trim().length > 0) {
          return {
            success: false,
            error: 'You have uncommitted local changes. Please push your changes first, or use "Force Pull" to discard local changes and sync with remote.'
          };
        }
      }

      let gitResult;
      if (force) {
        backupProfile(profileDir, alias);

        gitResult = await runGitCommand('git fetch origin', profileDir);
        if (!gitResult.success) return { success: false, error: parseGitPullError(gitResult.error || '') };

        gitResult = await runGitCommand(`git reset --hard origin/${currentBranch}`, profileDir);
        if (!gitResult.success) return { success: false, error: parseGitPullError(gitResult.error || '') };

        gitResult = await runGitCommand('git clean -fd', profileDir);
        if (!gitResult.success) return { success: false, error: parseGitPullError(gitResult.error || '') };
      } else {
        gitResult = await runGitCommand(`git pull origin ${currentBranch}`, profileDir);
        if (!gitResult.success) return { success: false, error: parseGitPullError(gitResult.error || '') };
      }

      await reloadAfterSync(alias);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: parseGitPullError(errorMsg) };
    }
  });

  ipcMain.handle('sync:checkExternalKnowledgeBases', async () => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);
      const profile = profileManager.getCachedProfile(alias);
      if (!profile) {
        return { success: true, externalKnowledgeBases: [] };
      }

      const externalKBs: ExternalKnowledgeBaseItem[] = [];
      for (const chat of profile.chats) {
        const agents = getChatAgents(chat);
        for (const agent of agents) {
          if (!agent?.name) {
            continue;
          }
          const agentId = agentIdOf(agent);
          if (!isSafeAgentId(agentId)) {
            createLogger().warn(`[syncIPC] Skipping external knowledge check for unsafe agent id: ${JSON.stringify(agentId)}`);
            continue;
          }
          const knowledgeBase = agent.knowledge?.knowledgeBase || agent.knowledgeBase;
          if (knowledgeBase) {
            const normalizedKB = path.resolve(knowledgeBase);
            const normalizedProfile = path.resolve(profileDir);
            if (!isPathInsideOrEqual(normalizedProfile, normalizedKB)) {
              externalKBs.push({
                chatId: chat.chat_id,
                agentId,
                agentName: agent.name,
                knowledgeBase,
              });
            }
          }
        }
      }
      return { success: true, externalKnowledgeBases: externalKBs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', externalKnowledgeBases: [] };
    }
  });

  ipcMain.handle('sync:copyKnowledgeBasesToProfile', async (_event, items: CopyKnowledgeBaseItem[]) => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);
      const fsp = fs.promises;

      const copyRecursive = async (src: string, dest: string) => {
        const stat = await fsp.stat(src);
        if (stat.isDirectory()) {
          await fsp.mkdir(dest, { recursive: true });
          const children = await fsp.readdir(src);
          for (const child of children) {
            await copyRecursive(path.join(src, child), path.join(dest, child));
          }
        } else {
          let finalDest = dest;
          try {
            const destStat = await fsp.stat(dest);
            if (destStat.isDirectory()) {
              finalDest = path.join(dest, path.basename(src));
            }
          } catch {
            // The recursive directory path passes the final file path directly.
          }
          await fsp.copyFile(src, finalDest);
        }
      };

      for (const item of items) {
        // Keep both ids confined: chatId is still passed through profile CRUD
        // (which derives chat-owned paths), and agentId builds agents/{id}/knowledge.
        if (!isSafeAgentId(item.chatId)) {
          createLogger().warn(`[syncIPC] Skipping knowledge copy for unsafe chat id: ${JSON.stringify(item.chatId)}`);
          continue;
        }
        if (!isSafeAgentId(item.agentId)) {
          createLogger().warn(`[syncIPC] Skipping knowledge copy for unsafe agent id: ${JSON.stringify(item.agentId)}`);
          continue;
        }

        const chat = profileManager.getAllChatConfigs(alias).find(candidate => candidate.chat_id === item.chatId);
        const agents = getChatAgents(chat);
        const targetAgent = agents.find(agent => agent?.name && agentIdOf(agent) === item.agentId);
        if (!chat || !targetAgent) {
          return {
            success: false,
            error: `Agent "${item.agentId}" was not found in chat "${item.chatId}".`,
          };
        }

        const srcPath = path.resolve(item.knowledgeBase);
        try {
          await fsp.access(srcPath);
        } catch {
          continue;
        }

        const destDir = getAgentKnowledgeDir(profileDir, item.agentId);
        await fsp.mkdir(destDir, { recursive: true });
        await copyRecursive(srcPath, destDir);

        const agentUpdates: Partial<ChatAgent> = {
          knowledgeBase: destDir,
          knowledge: {
            ...(targetAgent.knowledge || {}),
            knowledgeBase: destDir,
          },
        };

        const primaryAgent = getChatPrimaryAgent(chat);
        const primaryAgentId = primaryAgent?.name ? agentIdOf(primaryAgent) : undefined;
        const updated = primaryAgentId === item.agentId
          ? await profileManager.updateChatAgent(alias, item.chatId, agentUpdates)
          : await profileManager.updateChatConfig(alias, item.chatId, {
              agent: primaryAgent ?? agents[0],
              agents: agents.map(agent =>
                agent?.name && agentIdOf(agent) === item.agentId
                  ? { ...agent, ...agentUpdates, id: item.agentId }
                  : agent
              ),
            });

        if (!updated) {
          return {
            success: false,
            error: `Failed to update knowledge base for agent "${targetAgent.name}".`,
          };
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sync:push', async (_event, force: boolean, needCommit: boolean = true) => {
    try {
      const profileManager = await getProfileCacheManager();
      const alias = getCurrentAlias();
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);

      if (!fs.existsSync(path.join(profileDir, '.git'))) {
        return { success: false, error: 'Sync repository not initialized' };
      }

      const currentBranch = await getCurrentBranch(profileDir);

      if (needCommit) {
        const addResult = await runGitCommand('git add -A', profileDir);
        if (!addResult.success) {
          return { success: false, error: parseGitPushError(addResult.error || '') };
        }

        await runGitCommand(`git commit -m "${buildCommitMessage()}"`, profileDir);
      }

      let gitResult;
      if (force) {
        gitResult = await runGitCommand(`git push -f origin ${currentBranch}`, profileDir);
      } else {
        gitResult = await runGitCommand(`git push origin ${currentBranch}`, profileDir);
      }

      if (!gitResult.success) {
        return { success: false, error: parseGitPushError(gitResult.error || '') };
      }

      await profileManager.updateSyncSettings(alias, { lastSyncTime: new Date().toISOString() });
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: parseGitPushError(errorMsg) };
    }
  });

  ipcMain.handle('sync:merge', async () => {
    try {
      const alias = getCurrentAlias();
      const profileDir = path.join(app.getPath('userData'), 'profiles', alias);

      if (!fs.existsSync(path.join(profileDir, '.git'))) {
        return { success: false, error: 'Sync repository not initialized' };
      }

      const currentBranch = await getCurrentBranch(profileDir);

      // 1. Backup before rebase
      backupProfile(profileDir, alias);

      // 2. Commit local changes
      await runGitCommand('git add -A', profileDir);
      await runGitCommand(`git commit -m "${buildCommitMessage()}"`, profileDir);

      // 3. Fetch remote
      const fetchResult = await runGitCommand('git fetch origin', profileDir);
      if (!fetchResult.success) {
        return { success: false, error: parseGitPullError(fetchResult.error || 'Failed to fetch remote') };
      }

      // 4. Check if remote branch exists
      const remoteRefResult = await runGitCommand(`git rev-parse --verify origin/${currentBranch}`, profileDir);
      if (!remoteRefResult.success) {
        // No remote — nothing to rebase onto, just succeed
        return { success: true };
      }

      // 5. Rebase local on top of remote — local wins on conflicts
      //    In rebase context, -X theirs = keep the replayed (local) commits' version
      const rebaseResult = await runGitCommand(
        `git rebase -X theirs origin/${currentBranch}`,
        profileDir,
      );

      if (!rebaseResult.success) {
        await runGitCommand('git rebase --abort', profileDir);
        return { success: false, error: 'Rebase failed. Use "Force Pull" to overwrite local with remote, or "Force Push" to overwrite remote with local.' };
      }

      await reloadAfterSync(alias);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
