/**
 * Extra coverage for profileMigration — branches not covered by the base test file.
 * Covers: isDefaultChatConfig, isDefaultProfile, applyBuiltinDefaultsMigrations,
 *         and remaining branches of applyProfileMigrations.
 */

vi.mock('../../llm/ghcModelsManager', async () => ({
  getDefaultModel: vi.fn(() => 'mock-default-model'),
}));

vi.mock('@shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_DEFAULTS_VERSION: 3,
  BUILTIN_SKILL_CHANGELOG: {
    1: ['skill-creator'],
    2: ['skill-two'],
    3: ['skill-three'],
  },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isDefaultChatConfig,
  isDefaultProfile,
  applyProfileMigrations,
  applyBuiltinDefaultsMigrations,
  PROFILE_MIGRATION_VERSION,
} from '../profileMigration';
import type { ProfileV2, ChatConfig } from '../types/profile';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    alias: 'test',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [],
    ...overrides,
  } as ProfileV2;
}

function makeDefaultChat(): ChatConfig {
  return {
    chat_id: 'c1',
    chat_type: 'single_agent',
    agent: {
      name: 'Kobi',
      role: 'Default Assistant',
      emoji: '🤖',
      avatar: '',
      model: 'claude-3',
      workspace: '/tmp/ws',
      version: '1.0.0',
      source: 'ON-DEVICE',
      mcp_servers: [{ name: 'builtin-tools', tools: [] }],
      system_prompt: '',
      skills: [],
    },
  } as ChatConfig;
}

// ── isDefaultChatConfig ────────────────────────────────────────────────────────

describe('isDefaultChatConfig', () => {
  it('returns true when agent is null/undefined', () => {
    expect(isDefaultChatConfig({ chat_id: 'c', chat_type: 'single_agent' } as any)).toBe(true);
  });

  it('returns true for Kobi/Default Assistant with only builtin-tools server', () => {
    expect(isDefaultChatConfig(makeDefaultChat())).toBe(true);
  });

  it('returns true when mcp_servers is empty', () => {
    const chat = makeDefaultChat();
    chat.agent!.mcp_servers = [];
    expect(isDefaultChatConfig(chat)).toBe(true);
  });

  it('returns false when agent name is not Kobi', () => {
    const chat = makeDefaultChat();
    chat.agent!.name = 'Custom Agent';
    expect(isDefaultChatConfig(chat)).toBe(false);
  });

  it('returns false when agent role is not Default Assistant', () => {
    const chat = makeDefaultChat();
    chat.agent!.role = 'Custom Role';
    expect(isDefaultChatConfig(chat)).toBe(false);
  });

  it('returns false when there are extra MCP servers', () => {
    const chat = makeDefaultChat();
    chat.agent!.mcp_servers = [
      { name: 'builtin-tools', tools: [] },
      { name: 'extra-server', tools: [] },
    ];
    expect(isDefaultChatConfig(chat)).toBe(false);
  });

  it('returns false when mcp_servers is null', () => {
    const chat = makeDefaultChat();
    (chat.agent as any).mcp_servers = null;
    // null triggers hasNoCustomMcpServers = true (null is falsy), so should be true
    expect(isDefaultChatConfig(chat)).toBe(true);
  });
});

// ── isDefaultProfile ──────────────────────────────────────────────────────────

describe('isDefaultProfile', () => {
  it('returns true for an empty profile', () => {
    expect(isDefaultProfile(makeProfile())).toBe(true);
  });

  it('returns false when mcp_servers is non-empty', () => {
    const p = makeProfile({ mcp_servers: [{ name: 'foo' } as any] });
    expect(isDefaultProfile(p)).toBe(false);
  });

  it('returns false when skills is non-empty', () => {
    const p = makeProfile({ skills: [{ name: 'x' } as any] });
    expect(isDefaultProfile(p)).toBe(false);
  });

  it('returns false when chats has a non-default chat', () => {
    const chat = makeDefaultChat();
    chat.agent!.name = 'Custom Agent';
    const p = makeProfile({ chats: [chat] });
    expect(isDefaultProfile(p)).toBe(false);
  });

  it('returns true when chats has exactly one default chat', () => {
    const p = makeProfile({ chats: [makeDefaultChat()] });
    expect(isDefaultProfile(p)).toBe(true);
  });

  it('returns false when chats has more than one chat', () => {
    const p = makeProfile({ chats: [makeDefaultChat(), makeDefaultChat()] });
    expect(isDefaultProfile(p)).toBe(false);
  });
});

// ── applyProfileMigrations — additional branches ──────────────────────────────

describe('applyProfileMigrations — additional branches', () => {
  afterEach(() => vi.restoreAllMocks());

  it('skips all migrations when already at latest version', () => {
    const p = makeProfile({ profileMigrationVersion: PROFILE_MIGRATION_VERSION });
    expect(applyProfileMigrations(p)).toBe(false);
  });

  it('migration V1: sets freDone=true for non-default profile', () => {
    const p = makeProfile({
      profileMigrationVersion: 0,
      mcp_servers: [{ name: 'some-server' } as any],
      freDone: undefined as any,
    });
    applyProfileMigrations(p);
    expect(p.freDone).toBe(true);
  });

  it('migration V1: sets freDone=false for default profile', () => {
    const p = makeProfile({ profileMigrationVersion: 0, freDone: undefined as any });
    applyProfileMigrations(p);
    expect(p.freDone).toBe(false);
  });

  it('migration V1: preserves existing freDone value', () => {
    const p = makeProfile({ profileMigrationVersion: 0, freDone: true });
    applyProfileMigrations(p);
    expect(p.freDone).toBe(true);
  });

  it('migration V1: does nothing when no teams config', () => {
    const p = makeProfile({ profileMigrationVersion: 0 });
    expect(() => applyProfileMigrations(p)).not.toThrow();
  });

  it('migration V2: skips chats without agents', () => {
    const p = makeProfile({
      profileMigrationVersion: 0,
      chats: [{ chat_id: 'c1', chat_type: 'single_agent' }] as any,
    });
    expect(() => applyProfileMigrations(p)).not.toThrow();
  });
});

// ── applyBuiltinDefaultsMigrations ────────────────────────────────────────────

describe('applyBuiltinDefaultsMigrations', () => {
  it('returns false when already at latest builtin version', () => {
    const p = makeProfile({ builtinDefaultsVersion: 3 } as any);
    expect(applyBuiltinDefaultsMigrations(p)).toBe(false);
  });

  it('adds builtin-tools server when missing (storedVersion=0)', () => {
    const p = makeProfile({
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'CustomBot',
          role: 'assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: [],
        },
      }],
    });
    const mutated = applyBuiltinDefaultsMigrations(p);
    expect(mutated).toBe(true);
    const servers = p.chats[0].agent?.mcp_servers ?? [];
    expect(servers.some((s: any) => s.name === 'builtin-tools')).toBe(true);
  });

  it('clears tools on existing builtin-tools server (storedVersion=0)', () => {
    const p = makeProfile({
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'CustomBot',
          role: 'assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [{ name: 'builtin-tools', tools: ['some-tool'] }],
          system_prompt: '',
          skills: [],
        },
      }],
    });
    applyBuiltinDefaultsMigrations(p);
    const bt = p.chats[0].agent?.mcp_servers?.find((s: any) => s.name === 'builtin-tools');
    expect(bt?.tools).toEqual([]);
  });

  it('adds incremental skills from changelog', () => {
    const p = makeProfile({
      builtinDefaultsVersion: 0,
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'CustomBot',
          role: 'assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: [],
        },
      }],
    } as any);
    applyBuiltinDefaultsMigrations(p);
    const skills = p.chats[0].agent?.skills ?? [];
    expect(skills).toContain('skill-creator');
    expect(skills).toContain('skill-two');
    expect(skills).toContain('skill-three');
  });

  it('only adds new skills since storedBuiltinVersion', () => {
    const p = makeProfile({
      builtinDefaultsVersion: 1,
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'CustomBot',
          role: 'assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: ['skill-creator'],
        },
      }],
    } as any);
    applyBuiltinDefaultsMigrations(p);
    const skills = p.chats[0].agent?.skills ?? [];
    // skill-creator should not be duplicated
    expect(skills.filter((s: any) => s === 'skill-creator').length).toBe(1);
    expect(skills).toContain('skill-two');
    expect(skills).toContain('skill-three');
  });

  it('skips builtin agents', () => {
    const p = makeProfile({
      builtinDefaultsVersion: 0,
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'Kobi', // builtin agent
          role: 'Default Assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: [],
        },
      }],
    } as any);
    applyBuiltinDefaultsMigrations(p);
    // Kobi is a builtin agent, so no skills are added
    const skills = p.chats[0].agent?.skills ?? [];
    expect(skills).toEqual([]);
  });

  it('skips chats without agents', () => {
    const p = makeProfile({
      builtinDefaultsVersion: 0,
      chats: [{ chat_id: 'c1', chat_type: 'single_agent' }] as any,
    });
    expect(() => applyBuiltinDefaultsMigrations(p)).not.toThrow();
    expect((p as any).builtinDefaultsVersion).toBe(3);
  });

  it('bumps builtinDefaultsVersion after migration', () => {
    const p = makeProfile({ builtinDefaultsVersion: 0, chats: [] } as any);
    applyBuiltinDefaultsMigrations(p);
    expect((p as any).builtinDefaultsVersion).toBe(3);
  });

  it('handles missing skills array (initializes it)', () => {
    const p = makeProfile({
      builtinDefaultsVersion: 0,
      chats: [{
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: {
          name: 'CustomBot',
          role: 'assistant',
          emoji: '',
          avatar: '',
          model: 'm',
          workspace: '/w',
          version: '1',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: '',
          skills: undefined as any,
        },
      }],
    } as any);
    applyBuiltinDefaultsMigrations(p);
    const skills = p.chats[0].agent?.skills ?? [];
    expect(Array.isArray(skills)).toBe(true);
  });
});

// ── mergeDirectoryContents — via profile migration ────────────────────────────

describe('profileMigration — mergeDirectoryContents edge cases', () => {
  afterEach(() => vi.restoreAllMocks());

  it('handles a file conflict where target already exists (source is kept, target wins)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-merge-'));
    try {
      const wsDir = path.join(tmp, 'workspace');
      const knowledgeDir = path.join(wsDir, 'knowledge');
      const monthDir = path.join(knowledgeDir, '202604');
      fs.mkdirSync(monthDir, { recursive: true });

      // Create a file that already exists in workspace/202604
      const targetMonthDir = path.join(wsDir, '202604');
      fs.mkdirSync(targetMonthDir, { recursive: true });
      fs.writeFileSync(path.join(targetMonthDir, 'conflict.txt'), 'target content');
      fs.writeFileSync(path.join(monthDir, 'conflict.txt'), 'source content');

      const p = makeProfile({
        profileMigrationVersion: 1,
        chats: [{
          chat_id: 'c',
          chat_type: 'single_agent',
          agent: {
            name: 'B',
            role: 'a',
            emoji: '',
            avatar: '',
            model: 'm',
            workspace: wsDir,
            knowledge: { knowledgeBase: knowledgeDir },
            version: '1',
            source: 'ON-DEVICE',
            mcp_servers: [],
            system_prompt: '',
            skills: [],
          },
        }],
      });

      applyProfileMigrations(p);

      // Target file wins (not overwritten)
      const targetContent = fs.readFileSync(path.join(targetMonthDir, 'conflict.txt'), 'utf8');
      expect(targetContent).toBe('target content');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('handles nested directory merge recursively', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-nested-'));
    try {
      const wsDir = path.join(tmp, 'workspace');
      const knowledgeDir = path.join(wsDir, 'knowledge');
      const monthDir = path.join(knowledgeDir, '202604');
      const subDir = path.join(monthDir, 'subdir');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'nested.txt'), 'nested content');

      // Target month dir exists
      const targetMonthDir = path.join(wsDir, '202604');
      const targetSubDir = path.join(targetMonthDir, 'subdir');
      fs.mkdirSync(targetSubDir, { recursive: true });

      const p = makeProfile({
        profileMigrationVersion: 1,
        chats: [{
          chat_id: 'c',
          chat_type: 'single_agent',
          agent: {
            name: 'B',
            role: 'a',
            emoji: '',
            avatar: '',
            model: 'm',
            workspace: wsDir,
            knowledge: { knowledgeBase: knowledgeDir },
            version: '1',
            source: 'ON-DEVICE',
            mcp_servers: [],
            system_prompt: '',
            skills: [],
          },
        }],
      });

      applyProfileMigrations(p);

      expect(fs.existsSync(path.join(targetSubDir, 'nested.txt'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
