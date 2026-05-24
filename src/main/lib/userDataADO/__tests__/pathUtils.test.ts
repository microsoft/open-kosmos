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
  getDefaultWorkspacePath,
  getDefaultAgentWorkspacePath,
  isDefaultWorkspacePath,
  moveContentsToDirectory,
  ensureWorkspaceExists,
  getChatSessionsRootPath,
  getChatSessionsMonthPath,
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

  describe('getDefaultWorkspacePath', () => {
    it('throws when alias is empty', () => {
      expect(() => getDefaultWorkspacePath('', 'chat_001')).toThrow('alias is required');
    });

    it('throws when chatId is empty', () => {
      expect(() => getDefaultWorkspacePath('alice', '')).toThrow('Chat ID is required');
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
  });

});
