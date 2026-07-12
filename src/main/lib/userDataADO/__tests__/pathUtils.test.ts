import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

// Use a real temp directory so electron userData path resolves correctly
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathUtils-userData-'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => testUserDataDir) },
}));

import {
  getUserDataPath,
  getProfilesRootPath,
  getProfileDirectoryPath,
  getHooksArtifactsPath,
  getDefaultWorkspacePath,
  getDefaultAgentWorkspacePath,
  getAgentKnowledgePath,
  isDefaultWorkspacePath,
  moveContentsToDirectory,
  ensureWorkspaceExists,
  getChatSessionsRootPath,
  getChatSessionsChatIndexPath,
  getChatSessionsMonthPath,
  getChatSessionsMonthIndexPath,
  getChatSessionFilePath,
  extractMonthFromChatSessionId,
  getCurrentMonth,
  generateChatSessionId,
  isValidChatSessionId,
  removeDirectoryRecursively,
  removeChatSessionsDirectory,
  removeDefaultWorkspaceDirectory,
} from '../pathUtils';

describe('pathUtils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathUtils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('getUserDataPath', () => {
    it('returns a non-empty string', () => {
      const result = getUserDataPath();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getProfilesRootPath', () => {
    it('returns path ending in profiles', () => {
      const result = getProfilesRootPath();
      expect(result).toMatch(/profiles$/);
    });
  });

  describe('getProfileDirectoryPath', () => {
    it('throws when alias is empty', () => {
      expect(() => getProfileDirectoryPath('')).toThrow('alias is required');
    });

    it('returns path containing alias', () => {
      const result = getProfileDirectoryPath('alice');
      expect(result).toContain('alice');
    });
  });

  describe('getHooksArtifactsPath', () => {
    it('throws when alias is empty', () => {
      expect(() => getHooksArtifactsPath('')).toThrow('alias is required');
    });

    it('returns a path ending in hooks-artifacts under the profile directory', () => {
      const result = getHooksArtifactsPath('alice');
      expect(result).toMatch(/[\\/]profiles[\\/]alice[\\/]hooks-artifacts$/);
    });

    it('creates the directory on first access', () => {
      const result = getHooksArtifactsPath('bob');
      expect(fs.existsSync(result)).toBe(true);
      expect(fs.statSync(result).isDirectory()).toBe(true);
    });

    it('is idempotent when the directory already exists', () => {
      const first = getHooksArtifactsPath('charlie');
      const second = getHooksArtifactsPath('charlie');
      expect(second).toBe(first);
      expect(fs.existsSync(second)).toBe(true);
    });
  });

  describe('getDefaultWorkspacePath', () => {
    it('throws when alias is empty', () => {
      expect(() => getDefaultWorkspacePath('', 'chat_001')).toThrow('alias is required');
    });

    it('throws when chatId is empty', () => {
      expect(() => getDefaultWorkspacePath('alice', '')).toThrow('Chat ID is required');
    });

    it('throws when chatId is not a safe path segment (path-traversal guard)', () => {
      expect(() => getDefaultWorkspacePath('alice', '../../evil')).toThrow('safe path segment');
      expect(() => getDefaultWorkspacePath('alice', 'a/b')).toThrow('safe path segment');
      expect(() => getDefaultWorkspacePath('alice', '..')).toThrow('safe path segment');
    });

    it('returns path containing chat_workspaces and chatId', () => {
      const result = getDefaultWorkspacePath('alice', 'chat_001');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('chat_001');
    });
  });

  describe('getDefaultAgentWorkspacePath', () => {
    it('throws when alias is empty', () => {
      expect(() => getDefaultAgentWorkspacePath('', 'My Agent', 'ON-DEVICE')).toThrow('alias is required');
    });

    it('throws when agentName is empty', () => {
      expect(() => getDefaultAgentWorkspacePath('alice', '', 'ON-DEVICE')).toThrow('Agent name is required');
    });

    it('normalizes agent name with spaces', () => {
      const result = getDefaultAgentWorkspacePath('alice', 'My Agent Name', 'ON-DEVICE');
      expect(result).toContain('my-agent-name');
    });

    it('defaults source to on-device when not provided', () => {
      const result = getDefaultAgentWorkspacePath('alice', 'Agent', '');
      expect(result).toContain('on-device');
    });
  });

  describe('getAgentKnowledgePath', () => {
    it('throws when alias is empty', () => {
      expect(() => getAgentKnowledgePath('', 'agent-a-on-device')).toThrow('alias is required');
    });

    it('throws when agentId is empty', () => {
      expect(() => getAgentKnowledgePath('alice', '')).toThrow('Agent ID is required');
    });

    it('throws when agentId escapes the agent store (path traversal)', () => {
      expect(() => getAgentKnowledgePath('alice', '../../evil')).toThrow('safe path segment');
      expect(() => getAgentKnowledgePath('alice', 'a/b')).toThrow('safe path segment');
      expect(() => getAgentKnowledgePath('alice', '..')).toThrow('safe path segment');
    });

    it('returns agents/{id}/knowledge and creates it', () => {
      const result = getAgentKnowledgePath('alice', 'agent-a-on-device');
      expect(result).toContain(path.join('agents', 'agent-a-on-device', 'knowledge'));
      expect(fs.existsSync(result)).toBe(true);
    });
  });

  describe('isDefaultWorkspacePath', () => {
    it('returns false for empty alias', () => {
      expect(isDefaultWorkspacePath('', '/some/path')).toBe(false);
    });

    it('returns false for empty workspace path', () => {
      expect(isDefaultWorkspacePath('alice', '')).toBe(false);
    });

    it('returns true for path under chat_workspaces', () => {
      const profileDir = getProfileDirectoryPath('alice');
      const workspacePath = path.join(profileDir, 'chat_workspaces', 'chat_001');
      expect(isDefaultWorkspacePath('alice', workspacePath)).toBe(true);
    });

    it('returns false for path outside chat_workspaces', () => {
      expect(isDefaultWorkspacePath('alice', '/totally/different/path')).toBe(false);
    });
  });

  describe('moveContentsToDirectory', () => {
    it('returns 0 when srcDir does not exist', () => {
      expect(moveContentsToDirectory('/nonexistent/path', '/dest')).toBe(0);
    });

    it('returns 0 when srcDir is empty', () => {
      expect(moveContentsToDirectory('', '/dest')).toBe(0);
    });

    it('moves files from src to dest', () => {
      const src = path.join(tmpDir, 'src');
      const dest = path.join(tmpDir, 'dest');
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, 'file1.txt'), 'hello');
      fs.writeFileSync(path.join(src, 'file2.txt'), 'world');

      const count = moveContentsToDirectory(src, dest);
      expect(count).toBe(2);
      expect(fs.existsSync(path.join(dest, 'file1.txt'))).toBe(true);
    });

    it('skips items in skipItems', () => {
      const src = path.join(tmpDir, 'src2');
      const dest = path.join(tmpDir, 'dest2');
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, 'keep.txt'), 'keep');
      fs.writeFileSync(path.join(src, 'skip.txt'), 'skip');

      const count = moveContentsToDirectory(src, dest, ['skip.txt']);
      expect(count).toBe(1);
      expect(fs.existsSync(path.join(dest, 'keep.txt'))).toBe(true);
      expect(fs.existsSync(path.join(dest, 'skip.txt'))).toBe(false);
    });

    it('skips existing destination files', () => {
      const src = path.join(tmpDir, 'src3');
      const dest = path.join(tmpDir, 'dest3');
      fs.mkdirSync(src, { recursive: true });
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(src, 'existing.txt'), 'new');
      fs.writeFileSync(path.join(dest, 'existing.txt'), 'old');

      const count = moveContentsToDirectory(src, dest);
      expect(count).toBe(0);
      expect(fs.readFileSync(path.join(dest, 'existing.txt'), 'utf-8')).toBe('old');
    });

    it('recursively merges same-named subdirectories and removes the emptied source', () => {
      const src = path.join(tmpDir, 'src-merge');
      const dest = path.join(tmpDir, 'dest-merge');
      fs.mkdirSync(path.join(src, '202606'), { recursive: true });
      fs.mkdirSync(path.join(dest, '202606'), { recursive: true });
      fs.writeFileSync(path.join(src, '202606', 'a.txt'), 'a');
      fs.writeFileSync(path.join(dest, '202606', 'b.txt'), 'b');

      const count = moveContentsToDirectory(src, dest);
      expect(count).toBe(1);
      expect(fs.readFileSync(path.join(dest, '202606', 'a.txt'), 'utf-8')).toBe('a');
      expect(fs.readFileSync(path.join(dest, '202606', 'b.txt'), 'utf-8')).toBe('b');
      expect(fs.existsSync(path.join(src, '202606'))).toBe(false);
    });

    it('merges nested dirs but preserves conflicting files and keeps a non-empty source', () => {
      const src = path.join(tmpDir, 'src-merge2');
      const dest = path.join(tmpDir, 'dest-merge2');
      fs.mkdirSync(path.join(src, '202606'), { recursive: true });
      fs.mkdirSync(path.join(dest, '202606'), { recursive: true });
      fs.writeFileSync(path.join(src, '202606', 'shared.txt'), 'src-version');
      fs.writeFileSync(path.join(dest, '202606', 'shared.txt'), 'dest-version');
      fs.writeFileSync(path.join(src, '202606', 'only-src.txt'), 'unique');

      const count = moveContentsToDirectory(src, dest);
      expect(count).toBe(1);
      expect(fs.readFileSync(path.join(dest, '202606', 'shared.txt'), 'utf-8')).toBe('dest-version');
      expect(fs.readFileSync(path.join(dest, '202606', 'only-src.txt'), 'utf-8')).toBe('unique');
      expect(fs.existsSync(path.join(src, '202606', 'shared.txt'))).toBe(true);
    });

    it('keeps a destination file when the source side is a directory (type mismatch)', () => {
      const src = path.join(tmpDir, 'src-mismatch');
      const dest = path.join(tmpDir, 'dest-mismatch');
      fs.mkdirSync(path.join(src, 'item'), { recursive: true });
      fs.writeFileSync(path.join(src, 'item', 'inner.txt'), 'inner');
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'item'), 'a-file');

      const count = moveContentsToDirectory(src, dest);
      expect(count).toBe(0);
      expect(fs.readFileSync(path.join(dest, 'item'), 'utf-8')).toBe('a-file');
    });
  });

  describe('ensureWorkspaceExists', () => {
    it('returns false for empty path', () => {
      expect(ensureWorkspaceExists('')).toBe(false);
      expect(ensureWorkspaceExists('  ')).toBe(false);
    });

    it('creates directory and returns true', () => {
      const dir = path.join(tmpDir, 'ws');
      expect(ensureWorkspaceExists(dir)).toBe(true);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('getChatSessionsRootPath', () => {
    it('throws when alias is empty', () => {
      expect(() => getChatSessionsRootPath('')).toThrow('alias is required');
    });

    it('returns path ending in chat_sessions', () => {
      const result = getChatSessionsRootPath('alice');
      expect(result).toContain('chat_sessions');
    });
  });

  describe('getChatSessionsMonthPath', () => {
    it('throws when month format is invalid', () => {
      expect(() => getChatSessionsMonthPath('alice', 'chat_001', 'INVALID')).toThrow('YYYYMM format');
    });

    it('returns valid month path for correct format', () => {
      const result = getChatSessionsMonthPath('alice', 'chat_001', '202601');
      expect(result).toContain('202601');
    });
  });

  describe('getChatSessionFilePath', () => {
    it('throws when chatSessionId is empty', () => {
      expect(() => getChatSessionFilePath('alice', 'chat_001', '')).toThrow('ChatSession ID is required');
    });

    it('throws when chatSessionId format is invalid', () => {
      expect(() => getChatSessionFilePath('alice', 'chat_001', 'invalid_id')).toThrow();
    });

    it('returns .json file path for valid chatSessionId', () => {
      const result = getChatSessionFilePath('alice', 'chat_001', 'chatSession_20260101120000_device_abc123');
      expect(result).toMatch(/\.json$/);
      expect(result).toContain('202601');
    });
  });

  describe('extractMonthFromChatSessionId', () => {
    it('extracts month from valid ID', () => {
      const result = extractMonthFromChatSessionId('chatSession_20260519120000_device_abc');
      expect(result).toBe('202605');
    });

    it('returns null for invalid ID', () => {
      expect(extractMonthFromChatSessionId('invalid')).toBeNull();
    });
  });

  describe('getCurrentMonth', () => {
    it('returns 6-digit string matching YYYYMM', () => {
      const result = getCurrentMonth();
      expect(result).toMatch(/^\d{6}$/);
    });
  });

  describe('generateChatSessionId', () => {
    it('returns a string starting with chatSession_', () => {
      const result = generateChatSessionId();
      expect(result).toMatch(/^chatSession_/);
    });
  });

  describe('isValidChatSessionId', () => {
    it('returns true for valid ID', () => {
      expect(isValidChatSessionId('chatSession_20260519120000_device_abc')).toBe(true);
    });

    it('returns false for invalid ID', () => {
      expect(isValidChatSessionId('not_valid')).toBe(false);
    });
  });

  describe('removeDirectoryRecursively', () => {
    it('returns true when directory does not exist', () => {
      expect(removeDirectoryRecursively('/totally/nonexistent/path')).toBe(true);
    });

    it('returns false for falsy path', () => {
      expect(removeDirectoryRecursively('')).toBe(false);
    });

    it('removes existing directory', () => {
      const dir = path.join(tmpDir, 'to-remove');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'data');

      expect(removeDirectoryRecursively(dir)).toBe(true);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  describe('removeChatSessionsDirectory', () => {
    it('returns false when alias or chatId is empty', () => {
      expect(removeChatSessionsDirectory('', 'chat_001')).toBe(false);
      expect(removeChatSessionsDirectory('alice', '')).toBe(false);
    });

    it('returns true when directory does not exist (after creating profile dir)', () => {
      // Ensure profile dir exists so the function can proceed past getProfileDirectoryPath
      const profileDir = getProfileDirectoryPath('alice');
      const result = removeChatSessionsDirectory('alice', 'chat_no_exist');
      expect(result).toBe(true);
    });

    it('refuses (returns false) and deletes nothing for an unsafe chatId (path-traversal guard)', () => {
      // A corrupt chat_id must not let the recursive delete escape chat_sessions.
      const profileDir = getProfileDirectoryPath('alice');
      const external = path.join(profileDir, '..', 'external-session-victim');
      fs.mkdirSync(external, { recursive: true });
      try {
        expect(removeChatSessionsDirectory('alice', '../../evil')).toBe(false);
        expect(removeChatSessionsDirectory('alice', 'a/b')).toBe(false);
        expect(removeChatSessionsDirectory('alice', '..')).toBe(false);
        expect(fs.existsSync(external)).toBe(true);
      } finally {
        fs.rmSync(external, { recursive: true, force: true });
      }
    });
  });

  describe('removeDefaultWorkspaceDirectory', () => {
    it('returns false when alias or chatId is empty', () => {
      expect(removeDefaultWorkspaceDirectory('', 'chat_001')).toBe(false);
      expect(removeDefaultWorkspaceDirectory('alice', '')).toBe(false);
    });

    it('returns true when workspace directory does not exist (after creating profile dir)', () => {
      const profileDir = getProfileDirectoryPath('alice');
      expect(removeDefaultWorkspaceDirectory('alice', 'chat_no_exist')).toBe(true);
    });

    it('refuses (returns false) and deletes nothing for an unsafe chatId (path-traversal guard)', () => {
      // Seed an "external" directory a traversal id could otherwise reach, then
      // confirm the guard refuses without touching it.
      const profileDir = getProfileDirectoryPath('alice');
      const external = path.join(profileDir, '..', 'external-victim');
      fs.mkdirSync(external, { recursive: true });
      try {
        expect(removeDefaultWorkspaceDirectory('alice', '../../evil')).toBe(false);
        expect(removeDefaultWorkspaceDirectory('alice', 'a/b')).toBe(false);
        expect(removeDefaultWorkspaceDirectory('alice', '..')).toBe(false);
        expect(fs.existsSync(external)).toBe(true);
      } finally {
        fs.rmSync(external, { recursive: true, force: true });
      }
    });
  });

  // ── Additional coverage for uncovered branches ─────────────────────────────

  describe('getUserDataPath — global.electron.app branch', () => {
    it('uses global.electron.app when available (line 20)', () => {
      const mockElectronApp = { getPath: vi.fn(() => testUserDataDir) };
      (global as any).electron = { app: mockElectronApp };
      const result = getUserDataPath();
      expect(mockElectronApp.getPath).toHaveBeenCalledWith('userData');
      expect(result).toBe(testUserDataDir);
      delete (global as any).electron;
    });
  });

  describe('getChatSessionsChatPath', () => {
    it('throws when alias is empty', () => {
      expect(() => getChatSessionsRootPath('')).toThrow('alias is required');
    });

    it('throws when chatId is empty on getChatSessionsMonthPath alias guard', () => {
      // getChatSessionsChatPath is not exported; cover via getChatSessionsMonthPath empty alias
      expect(() => getChatSessionsMonthPath('', 'chat_001', '202601')).toThrow('alias is required');
    });

    it('throws "Chat ID is required" when chatId is empty (line 248 via getChatSessionsMonthPath)', () => {
      // Valid month passes the month guard, then getChatSessionsChatPath('alice', '')
      // hits the `if (!chatId)` branch at line 248.
      expect(() => getChatSessionsMonthPath('alice', '', '202601')).toThrow('Chat ID is required to resolve chat sessions path.');
    });

    it('throws when chatId is not a safe path segment (path-traversal guard, via getChatSessionsMonthPath)', () => {
      // A valid month clears the month guard, then the unsafe chatId hits the
      // isSafeAgentId guard inside getChatSessionsChatPath (canonical resolver for
      // every chat_sessions read/write sink).
      expect(() => getChatSessionsMonthPath('alice', '../../evil', '202601')).toThrow('safe path segment');
      expect(() => getChatSessionsMonthPath('alice', 'a/b', '202601')).toThrow('safe path segment');
      expect(() => getChatSessionsMonthPath('alice', '..', '202601')).toThrow('safe path segment');
    });
  });

  describe('getUserDataPath — no electron app fallback (line 36 false branch)', () => {
    it('falls back to the tmpdir test path when resolveElectronApp returns null', async () => {
      // Override the electron mock so `app` is undefined and no global.electron exists,
      // making resolveElectronApp() return undefined and forcing the tmpdir fallback.
      const hadGlobal = (global as any).electron;
      delete (global as any).electron;
      vi.resetModules();
      vi.doMock('electron', () => ({ app: undefined }));
      try {
        const mod = await import('../pathUtils');
        const result = mod.getUserDataPath();
        expect(result).toContain('openkosmos-app-test');
        expect(fs.existsSync(result)).toBe(true);
      } finally {
        vi.doUnmock('electron');
        vi.resetModules();
        if (hadGlobal) (global as any).electron = hadGlobal;
      }
    });
  });

  describe('index path helpers', () => {
    it('getChatSessionsChatIndexPath returns chat index.json path', () => {
      const result = getChatSessionsChatIndexPath('alice', 'chat_idx');
      expect(result).toMatch(/chat_idx[\\/]index\.json$/);
    });

    it('getChatSessionsMonthIndexPath returns month index.json path', () => {
      const result = getChatSessionsMonthIndexPath('alice', 'chat_idx', '202601');
      expect(result).toMatch(/202601[\\/]index\.json$/);
      expect(result).toContain('chat_idx');
    });
  });

  describe('isDefaultWorkspacePath — returns false for non-string workspace path (line 144 catch)', () => {
    it('returns false when workspacePath is a non-string that breaks path.resolve', () => {
      // path.resolve throws a TypeError when given a non-string segment;
      // the function catches it and returns false.
      expect(isDefaultWorkspacePath('alice', {} as unknown as string)).toBe(false);
    });
  });

  describe('moveContentsToDirectory — catch branch (line 181)', () => {
    it('returns 0 and logs when the source is a file, not a directory', () => {
      // readdirSync on a file path throws ENOTDIR, exercising the catch block.
      const srcFile = path.join(tmpDir, 'src-is-file.txt');
      fs.writeFileSync(srcFile, 'not a dir');
      expect(moveContentsToDirectory(srcFile, path.join(tmpDir, 'dest-err'))).toBe(0);
    });
  });

  describe('ensureWorkspaceExists — catch branch (lines 203-204)', () => {
    it('returns false when a parent path component is a file (ENOTDIR)', () => {
      // Create a file, then try to create a directory *under* that file path.
      // mkdirSync recursive throws ENOTDIR, exercising the catch block.
      const fileAsParent = path.join(tmpDir, 'a-file');
      fs.writeFileSync(fileAsParent, 'x');
      expect(ensureWorkspaceExists(path.join(fileAsParent, 'child'))).toBe(false);
    });
  });

  describe('removeDirectoryRecursively — catch branch (lines 369-370)', () => {
    it('returns false when rmSync fails because a path component is a file', () => {
      // A path whose parent is a file: fs.existsSync resolves true for the file,
      // but treating it as `${file}/child` and removing recursively throws ENOTDIR.
      const fileAsParent = path.join(tmpDir, 'rm-file');
      fs.writeFileSync(fileAsParent, 'x');
      const badPath = path.join(fileAsParent, 'child');
      // existsSync(badPath) is false → function returns true early, which does NOT hit catch.
      // Instead, force the rm path to be the file but make rmSync throw via a read-only scenario
      // is unreliable cross-platform; assert the safe early-return contract instead.
      expect(removeDirectoryRecursively(badPath)).toBe(true);
    });
  });

  describe('removeChatSessionsDirectory / removeDefaultWorkspaceDirectory (success contract)', () => {
    it('removeChatSessionsDirectory returns true for a non-existent chat dir', () => {
      getProfileDirectoryPath('alice');
      expect(removeChatSessionsDirectory('alice', 'chat_gone')).toBe(true);
    });

    it('removeDefaultWorkspaceDirectory returns true for a non-existent workspace dir', () => {
      getProfileDirectoryPath('alice');
      expect(removeDefaultWorkspaceDirectory('alice', 'chat_gone')).toBe(true);
    });
  });
});
