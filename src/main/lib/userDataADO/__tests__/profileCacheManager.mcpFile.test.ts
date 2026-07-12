/**
 * profileCacheManager.mcpFile.test.ts
 *
 * Integration tests for the Option B installed-server split: installed global MCP
 * servers are owned end-to-end by `McpConfigManager` (which is the ONLY
 * writer of `mcp.json`), while `ProfileCacheManager` writes only `profile.json`.
 *
 * These run against a real temp userData directory with the REAL manager
 * singleton and the real atomic writer, so the load handoff (mcp.json as source
 * of truth, legacy seeding, corrupt-file recovery), the two-file decoupling
 * (a profile write never touches mcp.json and an MCP-CRUD write never touches
 * profile.json), and the independent dirty-checks / `updatedAt` timestamps are
 * all exercised end to end.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Capture the real rename before any spy replaces it (used to let transient
// rename failures recover on retry).
const realRename = fs.promises.rename.bind(fs.promises);

const electronState = vi.hoisted(() => ({ userDataDir: '' }));

vi.mock('electron', async () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => electronState.userDataDir) },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

// The REAL McpConfigManager resolves mcp.json through pathUtils.getProfileDirectoryPath,
// so this mock must provide it (and create the directory the atomic writer expects)
// pointing at the same per-test temp profiles dir ProfileCacheManager uses.
vi.mock('../pathUtils', async () => {
  const nodePath = require('path');
  const nodeFs = require('fs');
  return {
    getProfileDirectoryPath: vi.fn((alias: string) => {
      const dir = nodePath.join(electronState.userDataDir, 'profiles', alias);
      nodeFs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
    getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
    getDefaultAgentWorkspacePath: vi.fn(() => '/mock/workspace/agent'),
    ensureWorkspaceExists: vi.fn(),
    removeChatSessionsDirectory: vi.fn(),
    removeDefaultWorkspaceDirectory: vi.fn(),
    isDefaultWorkspacePath: vi.fn(() => false),
    moveContentsToDirectory: vi.fn(),
  };
});

vi.mock('../chatSessionManager', async () => ({
  chatSessionManager: { loadChatSessions: vi.fn(), saveChatSession: vi.fn() },
}));

vi.mock('../../../../shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('@shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...(await vi.importActual('../../../../shared/constants/builtinSkills')),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));
vi.mock('@shared/constants/builtinSkills', async () => ({
  ...(await vi.importActual('@shared/constants/builtinSkills')),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn().mockResolvedValue({ sessions: [] }),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  ghcModelsManager: { initialize: vi.fn().mockResolvedValue(undefined) },
  getDefaultModel: vi.fn(() => 'gpt-5'),
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllMcpServerRuntimeStates: vi.fn(() => []),
    getMcpServerRuntimeState: vi.fn(() => null),
    _clearServerRuntimeState: vi.fn(),
    executeTool: vi.fn(),
  },
}));

vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../featureFlags/featureFlagManager', async () => ({
  featureFlagManager: { isEnabled: vi.fn(() => false) },
}));

vi.mock('../../startup/lazy', async () => ({
  getExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));


import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfileCacheManager } from '../profileCacheManager';
import { mcpConfigManager } from '../mcpConfigManager';
import { skillsConfigManager } from '../skillsConfigManager';
import { hooksConfigManager } from '../hooksConfigManager';
import { MCP_FILE_VERSION } from '../mcpFileStore';
import { BUILTIN_DEFAULTS_VERSION } from '../../../../shared/constants/builtinSkills';
import type { ProfileV2, McpServerConfig } from '../types/profile';

function freshManager(): ProfileCacheManager {
  (ProfileCacheManager as any).instance = undefined;
  return ProfileCacheManager.getInstance();
}

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'srv',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: {},
    url: '',
    in_use: true,
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  } as McpServerConfig;
}

function makeLegacyMemexServer(): McpServerConfig {
  return makeServer({
    name: 'memex-chat_1',
    transport: 'stdio',
    command: 'memex',
    args: ['mcp'],
    env: { MEMEX_HOME: '/profiles/alice/memex_memory/chat_1' },
    hidden: true,
  });
}

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    alias: 'alice',
    freDone: true,
    mcp_servers: [],
    skills: [],
    'starred-chat-sessions': [],
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Agent',
          model: 'gpt-5',
          workspace: '/ws',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [{ name: 'bound-srv', tools: [] }],
          system_prompt: { 'Base.md': '', 'AGENTS.md': '' },
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      },
    ],
    ...overrides,
  } as ProfileV2;
}

function profileDir(alias: string): string {
  return path.join(electronState.userDataDir, 'profiles', alias);
}

function profileJsonPath(alias: string): string {
  return path.join(profileDir(alias), 'profile.json');
}

function mcpJsonPath(alias: string): string {
  return path.join(profileDir(alias), 'mcp.json');
}

function skillsJsonPath(alias: string): string {
  return path.join(profileDir(alias), 'skills.json');
}

function hooksJsonPath(alias: string): string {
  return path.join(profileDir(alias), 'hooks.json');
}

function writeProfileFixture(alias: string, profile: ProfileV2): void {
  const dir = profileDir(alias);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(profileJsonPath(alias), JSON.stringify(profile, null, 2));
}

function writeMcpFixture(alias: string, servers: McpServerConfig[], updatedAt = ''): void {
  const dir = profileDir(alias);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    mcpJsonPath(alias),
    JSON.stringify({ version: MCP_FILE_VERSION, updatedAt, mcp_servers: servers }, null, 2),
  );
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mcpConfigManager.clearCache();
  skillsConfigManager.clearAll();
  hooksConfigManager.clearAll();
  electronState.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-split-mgr-'));
});

afterEach(() => {
  fs.rmSync(electronState.userDataDir, { recursive: true, force: true });
  mcpConfigManager.clearCache();
  skillsConfigManager.clearAll();
  hooksConfigManager.clearAll();
  vi.restoreAllMocks();
});

describe('ProfileCacheManager ↔ McpConfigManager — installed global MCP server split', () => {
  it('writeProfileToFile persists profile.json without installed server configs and never writes mcp.json', async () => {
    const mgr = freshManager();
    const profile = makeProfile({ mcp_servers: [makeServer({ name: 'serverX' })] });

    const ok = await (mgr as any).writeProfileToFile('alice', profile);
    expect(ok).toBe(true);

    const onDiskProfile = readJson(profileJsonPath('alice'));
    expect(onDiskProfile.mcp_servers).toBeUndefined();
    // Per-agent bindings are NOT installed global server configs and must survive.
    expect(onDiskProfile.chats[0].agent.mcp_servers).toEqual([{ name: 'bound-srv', tools: [] }]);
    // Installed server configs are owned by McpConfigManager; profile.json writes never touch mcp.json.
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);
  });

  it('treats mcp.json as the source of truth on load (it wins over a stale profile.json slice)', async () => {
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'stale' })] }));
    writeMcpFixture('alice', [makeServer({ name: 'fresh' })]);

    const mgr = freshManager();
    await (mgr as any).readProfileFromFile('alice');

    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['fresh']);
  });

  it('seeds mcp.json from a legacy profile.json slice on load and strips it from profile.json', async () => {
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'legacy' })] }));
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    // Installed server configs are the manager's; the returned profile no longer carries them.
    expect(loaded.mcp_servers).toBeUndefined();
    expect(mcpConfigManager.getServers('alice').map((s: McpServerConfig) => s.name)).toEqual(['legacy']);

    // mcp.json was seeded from the legacy slice on load.
    const onDiskMcp = readJson(mcpJsonPath('alice'));
    expect(onDiskMcp.version).toBe(MCP_FILE_VERSION);
    expect(onDiskMcp.mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    // The legacy slice was stripped from profile.json by the migration write-back.
    expect(readJson(profileJsonPath('alice')).mcp_servers).toBeUndefined();
  });

  it('commits installed server configs to mcp.json BEFORE profile.json is stripped on a migrating load', async () => {
    // Upgrade path: a legacy profile.json slice with no mcp.json yet. The load both
    // strips the slice from profile.json AND seeds mcp.json. If profile.json were
    // written (stripped) first and the mcp.json write then failed, installed servers would
    // be lost from BOTH files. Guard the ordering: mcp.json must be durably committed
    // before profile.json is rewritten without installed server configs.
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'legacy' })] }));
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);

    const renamedTargets: string[] = [];
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      renamedTargets.push(path.basename(String(to)));
      return realRename(from as any, to as any);
    });

    const mgr = freshManager();
    await (mgr as any).readProfileFromFile('alice');

    const firstMcpWrite = renamedTargets.indexOf('mcp.json');
    const firstProfileWrite = renamedTargets.indexOf('profile.json');
    expect(firstMcpWrite).toBeGreaterThanOrEqual(0);
    expect(firstProfileWrite).toBeGreaterThanOrEqual(0);
    expect(firstMcpWrite).toBeLessThan(firstProfileWrite);

    // Installed server configs are durably present in mcp.json after the load.
    expect(readJson(mcpJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
  });

  it('does not mark MCP migrations complete before post-migration mcp.json is durable', async () => {
    const legacyMemex = makeLegacyMemexServer();
    const regular = makeServer({ name: 'regular-server' });
    writeProfileFixture('alice', makeProfile({
      profileMigrationVersion: 3,
      mcp_servers: [legacyMemex, regular],
      chats: [{
        chat_id: 'chat_1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: 'bot',
          avatar: '',
          name: 'Legacy Memex Agent',
          model: 'gpt-5',
          workspace: '/ws',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [{ name: 'memex-chat_1', tools: [] }, { name: 'regular-server', tools: [] }],
          system_prompt: { 'Base.md': '', 'AGENTS.md': '' },
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      }],
    } as any));
    writeMcpFixture('alice', [legacyMemex, regular], '2020-01-01T00:00:00.000Z');

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });

    expect(loaded?.profileMigrationVersion).toBe(3);
    expect(readJson(profileJsonPath('alice')).profileMigrationVersion).toBe(3);
    expect(readJson(profileJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['memex-chat_1', 'regular-server']);
    expect(readJson(mcpJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['memex-chat_1', 'regular-server']);

    renameSpy.mockRestore();
    mcpConfigManager.clearCache('alice');
    const retried = await mgr.handleProfile('alice', { notifyRenderer: false });

    expect(retried?.profileMigrationVersion).toBe(7);
    expect(readJson(profileJsonPath('alice')).profileMigrationVersion).toBe(7);
    expect(readJson(profileJsonPath('alice')).mcp_servers).toBeUndefined();
    expect(readJson(mcpJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['regular-server']);
  });

  it('does not advance builtinDefaultsVersion when builtin defaults cannot sync to the agent store', async () => {
    const mgr = freshManager();
    const writeProfileSpy = vi.spyOn(mgr as any, 'writeProfileToFile');
    const profile = makeProfile({
      profileMigrationVersion: 6,
      builtinDefaultsVersion: BUILTIN_DEFAULTS_VERSION - 1,
      chats: [{
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        workspace: '/ws',
        agent_ids: ['../bad'],
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          id: '../bad',
          name: 'Custom Agent',
          model: 'gpt-5',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: { 'Base.md': '', 'AGENTS.md': '' },
          skills: [],
          zero_states: { greeting: '', quick_starts: [] },
        },
      }],
    });

    const loaded = await (mgr as any).ensureV2ProfileIntegrity('alice', profile);

    expect(loaded).toBe(profile);
    expect(loaded.builtinDefaultsVersion).toBe(BUILTIN_DEFAULTS_VERSION - 1);
    expect(writeProfileSpy).not.toHaveBeenCalled();
  });

  it('does not reset a valid profile when seeding mcp.json fails during load', async () => {
    writeProfileFixture('alice', makeProfile({ freDone: true, mcp_servers: [makeServer({ name: 'legacy' })] }));
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });

    expect(loaded?.freDone).toBe(true);
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['legacy']);
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);
    expect(readJson(profileJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    const backups = fs.readdirSync(profileDir('alice')).filter(f => f.startsWith('profile.json.corrupt-'));
    expect(backups).toHaveLength(0);
  });

  it('hydrates the skill registry from the legacy slice even when seeding mcp.json fails during load', async () => {
    // A legacy profile carries inline skills but no mcp.json yet. The mcp.json commit
    // fails (disk full), which returns early from readProfileFromFile BEFORE skills.json
    // migration runs. Because consumers read skills ONLY from SkillsConfigManager, the
    // registry must still be hydrated from the legacy slice — otherwise installed skills
    // would appear empty for the session and a later skill CRUD could overwrite skills.json
    // from an empty registry, dropping the legacy skills.
    const legacySkills = [
      { name: 'web-search', description: 'Search the web', version: '1.2.0', remoteVersion: '', source: 'ON-DEVICE' as const },
    ];
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'legacy' })], skills: legacySkills }));
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    // Early return: mcp.json was not committed and profile.json keeps its legacy slices.
    expect(loaded).not.toBeNull();
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);
    // The skill registry is hydrated from the legacy slice despite the mcp.json failure.
    expect(skillsConfigManager.getSkills('alice').map(s => s.name)).toEqual(['web-search']);
  });

  it('strips orphaned plugin MCP servers/skills/bindings when seeding mcp.json fails during load', async () => {
    // Regression guard for the post-plugin-removal upgrade: the mcp.json-commit
    // failure path returns early, BEFORE ensureV2ProfileIntegrity()/sanitizeProfileV2()
    // runs. Without an in-memory sanitize on that path, a transient disk failure would
    // leave orphaned plugin--* / source:'PLUGIN' MCP servers, skills, and agent
    // bindings in the returned (and cached/notified) profile.
    const profile = makeProfile({
      mcp_servers: [
        makeServer({ name: 'legacy' }),
        makeServer({ name: 'plugin--acme--db', source: 'PLUGIN' as any }),
      ],
      skills: [
        { name: 'web-search', description: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' as const },
        { name: 'plugin--acme--lint', description: '', version: '1.0.0', remoteVersion: '', source: 'PLUGIN' as any },
      ],
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: {
            role: 'assistant', emoji: '🤖', avatar: '', name: 'Agent', model: 'gpt-5',
            workspace: '/ws', knowledgeBase: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE',
            mcp_servers: [{ name: 'bound-srv', tools: [] }, { name: 'plugin--acme--db', tools: [] }],
            system_prompt: { 'Base.md': '', 'AGENTS.md': '' }, skills: ['web-search', 'plugin--acme--lint'],
            zero_states: { greeting: '', quick_starts: [] },
          },
        },
      ] as any,
    });
    writeProfileFixture('alice', profile);
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    expect(loaded).not.toBeNull();
    // profile.json on disk is kept intact (no write happened on the failure path).
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(false);
    // ...but the returned profile has every orphaned plugin binding stripped.
    expect(loaded.mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    expect(loaded.skills.map((s: any) => s.name)).toEqual(['web-search']);
    expect(loaded.chats[0].agent.mcp_servers.map((s: any) => s.name)).toEqual(['bound-srv']);
    expect(loaded.chats[0].agent.skills).toEqual(['web-search']);
    // The renderer profile payload (and startup/ipc/profile.ts) re-inject
    // mcpConfigManager.getServers()/skillsConfigManager.getSkills() OVER the inline
    // fields, so those manager-owned caches must ALSO be plugin-free even though the
    // mcp.json write failed before persistServers could rewrite the cleaned list.
    expect(mcpConfigManager.getServers('alice').map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    expect(skillsConfigManager.getSkills('alice').map((s: any) => s.name)).toEqual(['web-search']);
  });

  it('strips orphaned plugin skills when the skills.json migration write fails during load', async () => {
    // The second early return: mcp.json commits, but the skills.json migration write
    // fails, so loadSkillRegistryForProfile returns null and readProfileFromFile
    // returns before ensureV2ProfileIntegrity(). The in-memory sanitize must still
    // drop retired plugin skills from the returned profile.
    const profile = makeProfile({
      mcp_servers: [makeServer({ name: 'legacy' })],
      skills: [
        { name: 'web-search', description: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' as const },
        { name: 'plugin--acme--lint', description: '', version: '1.0.0', remoteVersion: '', source: 'PLUGIN' as any },
      ],
    });
    writeProfileFixture('alice', profile);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'skills.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    expect(loaded).not.toBeNull();
    // mcp.json was committed (the first gate passed) ...
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(true);
    // ... and the orphaned plugin skill is stripped from the returned profile.
    expect(loaded.skills.map((s: any) => s.name)).toEqual(['web-search']);
    // The skills registry the renderer re-injects (skillsConfigManager.getSkills) must
    // also be plugin-free even though the skills.json migration write failed and left
    // the registry seeded from resolveFromDisk's sanitized legacy slice.
    expect(skillsConfigManager.getSkills('alice').map((s: any) => s.name)).toEqual(['web-search']);
  });

  it('strips orphaned plugin bindings when the hooks.json migration write fails during load', async () => {
    // The THIRD early return (added with the hooks.json sidecar split): mcp.json and
    // skills.json commit, but the hooks.json migration write fails, so
    // loadHookRegistryForProfile returns null and readProfileFromFile returns before
    // ensureV2ProfileIntegrity()/sanitizeProfileV2(). Without the in-memory sanitize on
    // this path, a transient disk failure would leave orphaned plugin--* agent bindings
    // in the returned profile (a non-empty agent mcp_servers acts as an allowlist, so a
    // dead plugin--* binding would zero out the agent's tools). Regression guard for the
    // #912 (hooks.json) merge, which originally returned the raw profile here.
    const profile = makeProfile({
      mcp_servers: [
        makeServer({ name: 'legacy' }),
        makeServer({ name: 'plugin--acme--db', source: 'PLUGIN' as any }),
      ],
      skills: [
        { name: 'web-search', description: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' as const },
        { name: 'plugin--acme--lint', description: '', version: '1.0.0', remoteVersion: '', source: 'PLUGIN' as any },
      ],
      hooks: [
        {
          id: 'hook-1', name: 'Greeter', version: '1.0.0', remoteVersion: '',
          source: 'ON-DEVICE', enabled: true, event: 'SessionStart',
          action: { type: 'command', command: 'echo hi' },
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        },
      ] as any,
      chats: [
        {
          chat_id: 'chat-1',
          chat_type: 'single_agent',
          agent: {
            role: 'assistant', emoji: '🤖', avatar: '', name: 'Agent', model: 'gpt-5',
            workspace: '/ws', knowledgeBase: '', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE',
            mcp_servers: [{ name: 'bound-srv', tools: [] }, { name: 'plugin--acme--db', tools: [] }],
            system_prompt: { 'Base.md': '', 'AGENTS.md': '' }, skills: ['web-search', 'plugin--acme--lint'],
            zero_states: { greeting: '', quick_starts: [] },
          },
        },
      ] as any,
    });
    writeProfileFixture('alice', profile);
    expect(fs.existsSync(hooksJsonPath('alice'))).toBe(false);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'hooks.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    expect(loaded).not.toBeNull();
    // The first two gates committed their sidecars; only hooks.json failed.
    expect(fs.existsSync(mcpJsonPath('alice'))).toBe(true);
    expect(fs.existsSync(skillsJsonPath('alice'))).toBe(true);
    // The discriminating assertions: agent-level plugin--* bindings are only stripped by
    // sanitizeProfileV2 (skipped on the raw return), so these catch the regression.
    expect(loaded.chats[0].agent.mcp_servers.map((s: any) => s.name)).toEqual(['bound-srv']);
    expect(loaded.chats[0].agent.skills).toEqual(['web-search']);
    // Profile-level slices and the re-injected manager caches stay plugin-free too.
    expect(loaded.mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    expect(loaded.skills.map((s: any) => s.name)).toEqual(['web-search']);
    expect(mcpConfigManager.getServers('alice').map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    expect(skillsConfigManager.getSkills('alice').map((s: any) => s.name)).toEqual(['web-search']);
  });

  it('hydrates an empty skill registry when the loaded profile carries no skills field', async () => {
    // Exercises the non-array branch of the pre-gate skill resolve: a profile with no
    // skills field at all still resolves to an empty registry (no crash, no undefined).
    const profile = makeProfile();
    delete (profile as Partial<ProfileV2>).skills;
    writeProfileFixture('alice', profile);

    const mgr = freshManager();
    const loaded = await (mgr as any).readProfileFromFile('alice');

    expect(loaded).not.toBeNull();
    expect(skillsConfigManager.getSkills('alice')).toEqual([]);
  });

  it('keeps a valid profile (no default reset) when persisting skills.json fails during migration', async () => {
    // A legacy profile carrying inline skills, with no skills.json yet. The skills.json
    // migration write fails (disk full). The load MUST keep the existing profile.json
    // intact and NOT bubble the throw to the read catch-all — otherwise handleProfile would
    // treat profile.json as unreadable and reset it to a default profile, losing the user's
    // agents/settings/chats. The registry stays hydrated from the pre-gate resolveFromDisk.
    const legacySkills = [
      { name: 'web-search', description: 'Search the web', version: '1.2.0', remoteVersion: '', source: 'ON-DEVICE' as const },
    ];
    writeProfileFixture('alice', makeProfile({ freDone: true, skills: legacySkills }));
    expect(fs.existsSync(skillsJsonPath('alice'))).toBe(false);

    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'skills.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });

    // The existing profile is preserved (not reset to a default profile).
    expect(loaded).not.toBeNull();
    expect(loaded?.freDone).toBe(true);
    expect(loaded?.chats?.[0]?.chat_id).toBe('chat-1');
    // No default-profile reset → the existing profile.json was not backed up.
    const backups = fs.readdirSync(profileDir('alice')).filter(f => f.startsWith('profile.json.') && f !== 'profile.json');
    expect(backups).toHaveLength(0);
    // profile.json keeps its legacy skills slice so the migration retries next load.
    expect(readJson(profileJsonPath('alice')).skills.map((s: any) => s.name)).toEqual(['web-search']);
    // The registry is hydrated in memory from the pre-gate resolveFromDisk.
    expect(skillsConfigManager.getSkills('alice').map(s => s.name)).toEqual(['web-search']);
  });

  it('aborts a later profile write rather than stripping a non-durable skills legacy slice', async () => {
    // The asymmetry fix: writeProfileToFile must commit skills.json BEFORE stripping the
    // legacy inline slice. Reproduces the data-loss path — legacy skills, no skills.json,
    // then a profile write while skills.json is non-durable — and proves the write aborts.
    writeProfileFixture('alice', makeProfile({
      freDone: true,
      skills: [{ name: 'web-search', description: 'Search', version: '1.0.0', remoteVersion: '', source: 'ON-DEVICE' as const }],
    }));

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'skills.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });
    expect(loaded).not.toBeNull();
    // Load could not write skills.json, so the legacy slice still lives on profile.json.
    expect(fs.existsSync(skillsJsonPath('alice'))).toBe(false);
    expect(readJson(profileJsonPath('alice')).skills.map((s: any) => s.name)).toEqual(['web-search']);

    // A later profile write while skills.json is still non-durable must abort (return
    // false) rather than strip the legacy slice — otherwise the installed skills are lost.
    loaded!.freDone = false;
    const writeOk = await (mgr as any).writeProfileToFile('alice', loaded);
    expect(writeOk).toBe(false);
    expect(readJson(profileJsonPath('alice')).freDone).toBe(true);
    expect(readJson(profileJsonPath('alice')).skills.map((s: any) => s.name)).toEqual(['web-search']);

    // Once skills.json can be written, the retry commits it and only then strips profile.json.
    renameSpy.mockRestore();
    const retryOk = await (mgr as any).writeProfileToFile('alice', loaded);
    expect(retryOk).toBe(true);
    expect(readJson(skillsJsonPath('alice')).skills.map((s: any) => s.name)).toEqual(['web-search']);
    expect(readJson(profileJsonPath('alice')).skills).toBeUndefined();
    expect(readJson(profileJsonPath('alice')).freDone).toBe(false);
  });

  it('aborts a later profile write rather than stripping a non-durable MCP legacy slice', async () => {
    writeProfileFixture('alice', makeProfile({ freDone: true, mcp_servers: [makeServer({ name: 'legacy' })] }));

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === 'mcp.json') {
        const err: NodeJS.ErrnoException = new Error('disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });
    expect(loaded).not.toBeNull();

    loaded!.freDone = false;
    const writeOk = await (mgr as any).writeProfileToFile('alice', loaded);
    expect(writeOk).toBe(false);
    expect(readJson(profileJsonPath('alice')).freDone).toBe(true);
    expect(readJson(profileJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);

    renameSpy.mockRestore();
    const retryOk = await (mgr as any).writeProfileToFile('alice', loaded);
    expect(retryOk).toBe(true);
    expect(readJson(mcpJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
    expect(readJson(profileJsonPath('alice')).mcp_servers).toBeUndefined();
    expect(readJson(profileJsonPath('alice')).freDone).toBe(false);
  });

  it('is idempotent: a fresh process re-loads the same installed server configs from the split files', async () => {
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'legacy' })] }));

    // First load seeds mcp.json.
    const seeder = freshManager();
    await (seeder as any).readProfileFromFile('alice');

    // Simulate a fresh process: drop the in-memory installed server configs and re-load from disk.
    mcpConfigManager.clearCache();
    const mgr = freshManager();
    await (mgr as any).readProfileFromFile('alice');

    expect(mcpConfigManager.getServers('alice').map((s: McpServerConfig) => s.name)).toEqual(['legacy']);
  });

  it('backs up a corrupt mcp.json and loads an empty installed server set (no silent data loss)', async () => {
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'x' })] }));
    fs.writeFileSync(mcpJsonPath('alice'), '{ not valid json');

    const mgr = freshManager();
    await (mgr as any).readProfileFromFile('alice');

    expect(mcpConfigManager.getServers('alice')).toEqual([]);
    const backups = fs.readdirSync(profileDir('alice')).filter(f => f.startsWith('mcp.json.corrupt-'));
    expect(backups).toHaveLength(1);
  });

  it('does not throw and loads empty when backing up a corrupt mcp.json fails', async () => {
    writeProfileFixture('alice', makeProfile({ mcp_servers: [makeServer({ name: 'x' })] }));
    fs.writeFileSync(mcpJsonPath('alice'), '{ not valid json');
    const realWriteFile = fs.promises.writeFile.bind(fs.promises);
    vi.spyOn(fs.promises, 'writeFile').mockImplementation((async (file: fs.PathLike, data: string | NodeJS.ArrayBufferView) => {
      if (String(file).includes('mcp.json.corrupt-')) {
        throw new Error('write failed');
      }
      return realWriteFile(file, data);
    }) as typeof fs.promises.writeFile);

    const mgr = freshManager();
    await (mgr as any).readProfileFromFile('alice');

    expect(mcpConfigManager.getServers('alice')).toEqual([]);
    const backups = fs.readdirSync(profileDir('alice')).filter(f => f.startsWith('mcp.json.corrupt-'));
    expect(backups).toHaveLength(0);
  });

  it('preserves a valid mcp.json when recovering from a corrupt profile.json (no installed server wipe)', async () => {
    // Valid installed server configs are on disk, but profile.json is unparseable, so the load
    // drops into the default-profile recovery branch. Recovery must NOT clobber
    // the still-valid mcp.json with an empty server set (regression guard).
    writeMcpFixture('alice', [makeServer({ name: 'keep' })], '2020-01-01T00:00:00.000Z');
    fs.writeFileSync(profileJsonPath('alice'), '{ not valid json');

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const recovered = await mgr.handleProfile('alice', { notifyRenderer: false });

    // Recovery happened: the corrupt profile.json was backed up and a default created.
    expect(recovered).not.toBeNull();
    const backups = fs.readdirSync(profileDir('alice')).filter(f => f.startsWith('profile.json.corrupt-'));
    expect(backups).toHaveLength(1);

    // The pre-existing installed server configs survived — they were NOT overwritten with an empty list,
    // and the no-op commit left mcp.json's own updatedAt untouched.
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['keep']);
    const onDiskMcp = readJson(mcpJsonPath('alice'));
    expect(onDiskMcp.mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['keep']);
    expect(onDiskMcp.updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('an MCP-CRUD add writes mcp.json (with its own updatedAt) but never profile.json', async () => {
    writeMcpFixture('alice', [makeServer({ name: 'keep' })], '2020-01-01T00:00:00.000Z');
    writeProfileFixture('alice', makeProfile());

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    await mgr.handleProfile('alice', { notifyRenderer: false });

    const profileBefore = fs.readFileSync(profileJsonPath('alice'), 'utf-8');
    const writeSpy = vi.spyOn(fs.promises, 'writeFile');

    const added = await mgr.addMcpServerConfig('alice', makeServer({ name: 'added' }));
    expect(added).toBe(true);

    // mcp.json was rewritten with the new server and the manager is authoritative.
    expect(mcpConfigManager.getServers('alice').map(s => s.name)).toEqual(['keep', 'added']);
    expect(readJson(mcpJsonPath('alice')).mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['keep', 'added']);
    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('mcp.json')).length).toBeGreaterThan(0);

    // profile.json was NOT rewritten by the installed-MCP-server change.
    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('profile.json'))).toHaveLength(0);
    expect(fs.readFileSync(profileJsonPath('alice'), 'utf-8')).toBe(profileBefore);
  });

  it('does not rewrite mcp.json when only an unrelated profile field changes', async () => {
    writeMcpFixture('alice', [makeServer({ name: 'keep' })], '2020-01-01T00:00:00.000Z');
    writeProfileFixture('alice', makeProfile());

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });

    const writeSpy = vi.spyOn(fs.promises, 'writeFile');
    // Unrelated change: a profile field, with installed MCP servers left alone.
    loaded!.freDone = false;
    const ok = await (mgr as any).writeProfileToFile('alice', loaded);
    expect(ok).toBe(true);

    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('mcp.json'))).toHaveLength(0);
    expect(writeSpy.mock.calls.filter(([p]) => String(p).includes('profile.json')).length).toBeGreaterThan(0);
  });

  it('keeps the two files\u2019 updatedAt timestamps independent', async () => {
    writeMcpFixture('alice', [makeServer({ name: 'keep' })], '2020-01-01T00:00:00.000Z');
    writeProfileFixture('alice', makeProfile());

    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();
    const loaded = await mgr.handleProfile('alice', { notifyRenderer: false });

    // mcp.json was not rewritten on load (installed server configs unchanged) so it still carries
    // the fixture timestamp.
    const mcpUpdatedAtAfterLoad = readJson(mcpJsonPath('alice')).updatedAt;
    const profileUpdatedAtAfterLoad = readJson(profileJsonPath('alice')).updatedAt;
    expect(mcpUpdatedAtAfterLoad).toBe('2020-01-01T00:00:00.000Z');

    // 1) A pure MCP change (via CRUD) advances mcp.json's own updatedAt but leaves
    //    profile.json's untouched.
    await mgr.addMcpServerConfig('alice', makeServer({ name: 'changed' }));

    const mcpAfterMcpChange = readJson(mcpJsonPath('alice'));
    expect(mcpAfterMcpChange.mcp_servers.map((s: McpServerConfig) => s.name)).toEqual(['keep', 'changed']);
    expect(mcpAfterMcpChange.updatedAt).not.toBe(mcpUpdatedAtAfterLoad);
    expect(mcpAfterMcpChange.updatedAt).not.toBe('');
    expect(readJson(profileJsonPath('alice')).updatedAt).toBe(profileUpdatedAtAfterLoad);

    // 2) A pure profile change leaves mcp.json (and its updatedAt) untouched.
    loaded!.freDone = !loaded!.freDone;
    await (mgr as any).writeProfileToFile('alice', loaded);
    expect(readJson(mcpJsonPath('alice')).updatedAt).toBe(mcpAfterMcpChange.updatedAt);
  });

  it('logs and recovers from a transient rename failure for both split files', async () => {
    const mgr = freshManager();
    (mgr as any).initializeBackgroundServices = vi.fn();

    // Make the first rename of each distinct target throw a transient EBUSY, then
    // let the retry succeed via the real rename. This drives both onRetry loggers
    // (ProfileCacheManager for profile.json, McpConfigManager for mcp.json).
    const failedOnce = new Set<string>();
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      const target = String(to);
      if (!failedOnce.has(target)) {
        failedOnce.add(target);
        const err: NodeJS.ErrnoException = new Error('busy');
        err.code = 'EBUSY';
        throw err;
      }
      return realRename(from as string, to as string);
    });

    const created = await mgr.handleProfile('alice', { notifyRenderer: false });
    expect(created?.alias).toBe('alice');

    // Both files recovered and landed on disk.
    expect(readJson(profileJsonPath('alice')).alias).toBe('alice');
    expect(readJson(mcpJsonPath('alice')).mcp_servers).toEqual([]);
  });
});
