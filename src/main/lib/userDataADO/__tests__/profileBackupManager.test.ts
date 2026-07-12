import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '9.9.9-test') },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import {
  PROFILE_BACKUP_DIR_NAME,
  PROFILE_BACKUP_RETENTION_MS,
  backupProfileDirectoryBeforeMutation,
  cleanupExpiredProfileBackups,
  resetProfileBackupStateForTests,
} from '../profileBackupManager';

describe('profileBackupManager', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-backup-'));
    resetProfileBackupStateForTests();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    resetProfileBackupStateForTests();
  });

  function writeFile(relativePath: string, body = '{}'): void {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);
  }

  it('backs up profile metadata and excludes heavy directories', async () => {
    writeFile('profile.json', JSON.stringify({
      version: '2.0.0',
      chats: [
        {
          chat_id: 'chat-a',
          chat_type: 'single_agent',
          agent: { name: 'Agent', authToken: 'agent-profile-token' },
        },
      ],
      mcp_servers: [
        {
          name: 'legacy',
          env: { API_KEY: 'legacy-env-secret' },
          headers: { Authorization: 'Bearer legacy-header-secret' },
        },
      ],
    }));
    writeFile('agents/index.json', '[]');
    writeFile('agents/agent-a/agent.json', JSON.stringify({
      id: 'agent-a',
      name: 'Agent',
      authToken: 'agent-store-token',
    }));
    writeFile('agents/agent-a/knowledge/large.md', 'large');
    writeFile('agents/agent-a/memory/card.json', '{"body":"large memory"}');
    writeFile('memex_memory/chat-a/card.json', '{"body":"legacy memory"}');
    writeFile('profile-memory/card.json', '{"body":"profile memory"}');
    writeFile('mcp.json', JSON.stringify({
      mcp_servers: [
        {
          name: 'server',
          env: { GITHUB_TOKEN: 'mcp-env-secret' },
          headers: { Authorization: 'Bearer mcp-header-secret' },
          oauth: { clientId: 'public-client-id', clientSecret: 'mcp-client-secret' },
        },
      ],
    }));
    writeFile('chat_sessions/chat-a/202607/session.json', 'large');
    writeFile('chat_workspaces/chat-a/output.txt', 'large');
    writeFile('skills/big-skill/file.txt', 'large');
    writeFile('archive/archived_agents.json', '[]');
    writeFile('auth.json', '{"ghcAuth":{"gitHubTokens":{"access_token":"secret"}}}');
    writeFile('credentials/browserAuthTokenCache.json', '{"refreshToken":"secret"}');
    writeFile('browser-session-state.json', '{"cookies":[]}');

    const result = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(result.success).toBe(true);
    expect(result.backupDir).toBeDefined();
    const backupDir = result.backupDir!;
    expect(fs.existsSync(path.join(backupDir, 'profile.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'agents/index.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'agents/agent-a/agent.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'archive/archived_agents.json'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'agents/agent-a/knowledge'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'agents/agent-a/memory'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'memex_memory'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'profile-memory'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'chat_sessions'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'chat_workspaces'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'auth.json'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'credentials'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'browser-session-state.json'))).toBe(false);

    const backedUpProfile = JSON.parse(fs.readFileSync(path.join(backupDir, 'profile.json'), 'utf-8'));
    expect(backedUpProfile.chats[0].agent.authToken).toBe('[redacted]');
    expect(backedUpProfile.mcp_servers[0].env.API_KEY).toBe('[redacted]');
    expect(backedUpProfile.mcp_servers[0].headers.Authorization).toBe('[redacted]');
    const backedUpAgent = JSON.parse(fs.readFileSync(path.join(backupDir, 'agents/agent-a/agent.json'), 'utf-8'));
    expect(backedUpAgent.authToken).toBe('[redacted]');
    const backedUpMcp = JSON.parse(fs.readFileSync(path.join(backupDir, 'mcp.json'), 'utf-8'));
    expect(backedUpMcp.mcp_servers[0].env.GITHUB_TOKEN).toBe('[redacted]');
    expect(backedUpMcp.mcp_servers[0].headers.Authorization).toBe('[redacted]');
    expect(backedUpMcp.mcp_servers[0].oauth.clientId).toBe('public-client-id');
    expect(backedUpMcp.mcp_servers[0].oauth.clientSecret).toBe('[redacted]');

    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup.json'), 'utf-8'));
    expect(manifest).toMatchObject({
      version: 1,
      alias: 'alice',
      appVersion: '9.9.9-test',
      reason: 'startup-before-profile-mutation',
    });
    expect(manifest.excludedDirectoryNames).toContain('credentials');
    expect(manifest.excludedFileNames).toEqual(expect.arrayContaining(['auth.json', 'browser-session-state.json']));
    expect(manifest.copiedFiles).toBeGreaterThanOrEqual(4);
    expect(manifest.skippedDirectories).toBeGreaterThanOrEqual(8);
    expect(manifest.skippedFiles).toBeGreaterThanOrEqual(2);
    expect(manifest.redactedJsonFiles).toBeGreaterThanOrEqual(5);
  });

  it('runs only once per profile and alias in one process', async () => {
    writeFile('profile.json', '{}');

    const first = await backupProfileDirectoryBeforeMutation(dir, 'alice');
    const second = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(first.success).toBe(true);
    expect(second).toEqual({ success: true, skipped: true });
    const backupsRoot = path.join(dir, PROFILE_BACKUP_DIR_NAME);
    const backupDirs = fs.readdirSync(backupsRoot).filter(name => !name.startsWith('.tmp-'));
    expect(backupDirs).toHaveLength(1);
  });

  it('cleans backups older than 24 hours and stale temporary directories', () => {
    const backupsRoot = path.join(dir, PROFILE_BACKUP_DIR_NAME);
    const oldBackup = path.join(backupsRoot, 'old');
    const freshBackup = path.join(backupsRoot, 'fresh');
    const oldTmp = path.join(backupsRoot, '.tmp-old');
    fs.mkdirSync(oldBackup, { recursive: true });
    fs.mkdirSync(freshBackup, { recursive: true });
    fs.mkdirSync(oldTmp, { recursive: true });
    fs.writeFileSync(path.join(backupsRoot, 'not-a-directory'), '');

    const now = Date.now();
    const old = new Date(now - PROFILE_BACKUP_RETENTION_MS - 1_000);
    fs.utimesSync(oldBackup, old, old);
    fs.utimesSync(oldTmp, old, old);

    cleanupExpiredProfileBackups(dir, now);

    expect(fs.existsSync(oldBackup)).toBe(false);
    expect(fs.existsSync(oldTmp)).toBe(false);
    expect(fs.existsSync(freshBackup)).toBe(true);
  });

  it('returns a failed result when the final rename fails', async () => {
    writeFile('profile.json', '{}');
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValue(new Error('rename failed'));

    const result = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(result).toMatchObject({ success: false, error: 'rename failed' });
    renameSpy.mockRestore();
  });

  it('returns a stringified failure when a filesystem operation rejects with a non-error value', async () => {
    writeFile('profile.json', '{}');
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValue('rename failed');

    const result = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(result).toMatchObject({ success: false, error: 'rename failed' });
    renameSpy.mockRestore();
  });

  it('omits invalid json content from the startup backup instead of copying it verbatim', async () => {
    writeFile('profile.json', '{}');
    writeFile('mcp.json', '{"mcp_servers":[');

    const result = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(result.success).toBe(true);
    const backupDir = result.backupDir!;
    const backedUpMcp = JSON.parse(fs.readFileSync(path.join(backupDir, 'mcp.json'), 'utf-8'));
    expect(backedUpMcp).toMatchObject({
      backupRedaction: {
        reason: 'invalid-json-omitted',
        originalFileName: 'mcp.json',
      },
    });
    expect(JSON.stringify(backedUpMcp)).not.toContain('mcp_servers');
  });

  it('preserves invalid profile.json bytes so corrupt-profile recovery is possible', async () => {
    const originalProfile = '{"chats":[{"chat_id":"manual-recover","agent":{"authToken":"secret"}},';
    writeFile('profile.json', originalProfile);
    writeFile('mcp.json', '{"mcp_servers":[');

    const result = await backupProfileDirectoryBeforeMutation(dir, 'alice');

    expect(result.success).toBe(true);
    const backupDir = result.backupDir!;
    expect(fs.readFileSync(path.join(backupDir, 'profile.json'), 'utf-8')).toBe(originalProfile);
    const backedUpMcp = JSON.parse(fs.readFileSync(path.join(backupDir, 'mcp.json'), 'utf-8'));
    expect(backedUpMcp.backupRedaction.reason).toBe('invalid-json-omitted');
  });
});
