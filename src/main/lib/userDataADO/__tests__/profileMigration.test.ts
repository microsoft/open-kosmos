vi.mock('../../llm/ghcModelsManager', async () => ({
  getDefaultModel: vi.fn(() => 'mock-default-model'),
}));

vi.mock('@shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_DEFAULTS_VERSION: 1,
  BUILTIN_SKILL_CHANGELOG: {
    1: ['skill-creator'],
  },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyProfileMigrations, PROFILE_MIGRATION_VERSION } from '../profileMigration';
import type { ProfileV2 } from '../types/profile';

function createProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
    alias: 'test-user',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [],
    ...overrides,
  } as ProfileV2;
}

describe('applyProfileMigrations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bumps migrated profiles to the current migration version', () => {
    const profile = createProfile({ profileMigrationVersion: 2 });

    const mutated = applyProfileMigrations(profile);

    expect(mutated).toBe(true);
    expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
  });

  it('fully migrates a pre-v1 legacy agent into the current cleaned knowledge shape', () => {
    const profile = createProfile({
      profileMigrationVersion: 0,
      chats: [{
        chat_id: 'chat_1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Legacy Agent',
          model: 'mock-default-model',
          workspace: '/tmp/workspace/chat_1',
          knowledge: undefined,
          knowledgeBase: '/tmp/workspace/chat_1/knowledge',
          teams_enabled: true,
          teams_chats: [{
            chatId: 'team-chat-1',
            display: 'Team Chat 1',
            chatType: 'group',
            topic: 'Topic 1',
          }],
          outlook_emails_enabled: true,
          version: '1.0.0',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
          skills: [],
        } as never,
      }],
    });

    const mutated = applyProfileMigrations(profile);
    const agent = profile.chats[0].agent!;

    expect(mutated).toBe(true);
    expect(agent.knowledge).toEqual({
      knowledgeBase: '/tmp/workspace/chat_1/knowledge',
    });
    expect(agent.knowledgeBase).toBeUndefined();
    expect((agent as unknown as Record<string, unknown>).teams_enabled).toBeUndefined();
    expect((agent as unknown as Record<string, unknown>).teams_chats).toBeUndefined();
    expect((agent as unknown as Record<string, unknown>).outlook_emails_enabled).toBeUndefined();
    expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
  });

  it('keeps existing normalized knowledge intact when only a later migration version needs bumping', () => {
    const profile = createProfile({
      profileMigrationVersion: 2,
      chats: [{
        chat_id: 'chat_2',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Normalized Agent',
          model: 'mock-default-model',
          workspace: '/tmp/workspace/chat_2',
          knowledge: {
            knowledgeBase: '/tmp/workspace/chat_2/knowledge',
          },
          version: '1.0.0',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
          skills: [],
        },
      }],
    });

    const mutated = applyProfileMigrations(profile);

    expect(mutated).toBe(true);
    expect(profile.chats[0].agent?.knowledge).toEqual({
      knowledgeBase: '/tmp/workspace/chat_2/knowledge',
    });
    expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
  });

  it('migration v3 strips removed teams/outlook fields from both top-level and nested knowledge', () => {
    const legacyAgent = {
      role: 'assistant',
      emoji: '🤖',
      avatar: '',
      name: 'Legacy Teams Agent',
      model: 'mock-default-model',
      workspace: '/tmp/workspace/chat_legacy',
      knowledge: {
        knowledgeBase: '/tmp/workspace/chat_legacy/knowledge',
        teams_enabled: true,
        teams_chats: [{
          chatId: 'nested-chat-1',
          display: 'Nested Team Chat 1',
          chatType: 'meeting',
          topic: 'Nested Topic 1',
        }],
        outlook_emails_enabled: true,
      },
      teams_enabled: true,
      teams_chats: [{
        chatId: 'team-chat-1',
        display: 'Team Chat 1',
        chatType: 'group',
        topic: 'Topic 1',
      }],
      outlook_emails_enabled: true,
      version: '1.0.0',
      source: 'ON-DEVICE',
      mcp_servers: [],
      system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
      skills: [],
    };

    const profile = createProfile({
      profileMigrationVersion: 2,
      chats: [{
        chat_id: 'chat_legacy_cleanup',
        chat_type: 'single_agent',
        agent: legacyAgent as never,
      }],
    });

    const mutated = applyProfileMigrations(profile);
    const agent = profile.chats[0].agent as unknown as Record<string, unknown>;

    expect(mutated).toBe(true);
    expect(agent.knowledge).toEqual({
      knowledgeBase: '/tmp/workspace/chat_legacy/knowledge',
    });
    expect(agent.teams_enabled).toBeUndefined();
    expect(agent.teams_chats).toBeUndefined();
    expect(agent.outlook_emails_enabled).toBeUndefined();
  });

  it('migration v4 removes legacy hidden memex MCP servers and agent bindings without touching other servers', () => {
    const profile = createProfile({
      profileMigrationVersion: 3,
      mcp_servers: [
        {
          name: 'memex-chat_1',
          transport: 'stdio',
          command: 'memex',
          args: ['mcp'],
          env: { MEMEX_HOME: '/profiles/alice/memex_memory/chat_1' },
          url: '',
          in_use: true,
          hidden: true,
          source: 'ON-DEVICE',
        },
        {
          name: 'memex-user-visible',
          transport: 'stdio',
          command: 'custom-memex',
          args: [],
          env: {},
          url: '',
          in_use: true,
          hidden: false,
        },
        {
          name: 'memex-hidden-custom',
          transport: 'stdio',
          command: 'custom-memex',
          args: ['serve'],
          env: { MEMEX_HOME: '/profiles/alice/custom' },
          url: '',
          in_use: true,
          hidden: true,
        },
        {
          name: 'regular-server',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {},
          url: '',
          in_use: true,
        },
      ],
      chats: [{
        chat_id: 'chat_1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Memex Legacy Agent',
          model: 'mock-default-model',
          workspace: '/tmp/workspace/chat_1',
          version: '1.0.0',
          source: 'ON-DEVICE',
          mcp_servers: [
            { name: 'builtin-tools', tools: [] },
            { name: 'memex-chat_1', tools: [] },
            { name: 'memex-user-visible', tools: [] },
            { name: 'regular-server', tools: ['tool-a'] },
          ],
          system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
          skills: [],
        },
      }],
    });

    const mutated = applyProfileMigrations(profile);

    expect(mutated).toBe(true);
    expect((profile.mcp_servers ?? []).map((server) => server.name)).toEqual(['memex-user-visible', 'memex-hidden-custom', 'regular-server']);
    expect(profile.chats[0].agent?.mcp_servers.map((server) => server.name)).toEqual(['builtin-tools', 'memex-user-visible', 'regular-server']);
    expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
  });

  it('restores regressed YYYYMM delivery directories from workspace/knowledge back into workspace and merges duplicates', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-migration-'));
    try {
      const workspaceDir = path.join(tempRoot, 'workspace');
      const knowledgeDir = path.join(workspaceDir, 'knowledge');
      const existingMonthDir = path.join(workspaceDir, '202603');
      const regressedMonthDir = path.join(knowledgeDir, '202603');
      const regressedOnlyMonthDir = path.join(knowledgeDir, '202604');

      fs.mkdirSync(path.join(existingMonthDir, 'existing-delivery'), { recursive: true });
      fs.mkdirSync(path.join(regressedMonthDir, 'regressed-delivery'), { recursive: true });
      fs.mkdirSync(path.join(regressedOnlyMonthDir, 'fresh-delivery'), { recursive: true });

      fs.writeFileSync(path.join(existingMonthDir, 'existing-delivery', 'existing.txt'), 'existing');
      fs.writeFileSync(path.join(regressedMonthDir, 'regressed-delivery', 'moved.txt'), 'moved');
      fs.writeFileSync(path.join(regressedOnlyMonthDir, 'fresh-delivery', 'fresh.txt'), 'fresh');

      const profile = createProfile({
        profileMigrationVersion: 1,
        chats: [{
          chat_id: 'chat_restore',
          chat_type: 'single_agent',
          agent: {
            role: 'assistant',
            emoji: '🤖',
            avatar: '',
            name: 'Restore Agent',
            model: 'mock-default-model',
            workspace: workspaceDir,
            knowledge: {
              knowledgeBase: knowledgeDir,
            },
            version: '1.0.0',
            source: 'ON-DEVICE',
            mcp_servers: [],
            system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
            skills: [],
          },
        }],
      });

      const mutated = applyProfileMigrations(profile);

      expect(mutated).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, '202603', 'existing-delivery', 'existing.txt'))).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, '202603', 'regressed-delivery', 'moved.txt'))).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, '202604', 'fresh-delivery', 'fresh.txt'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, '202603'))).toBe(false);
      expect(fs.existsSync(path.join(knowledgeDir, '202604'))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('continues migration when restoring regressed delivery directories throws', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-migration-error-'));
    try {
      const workspaceDir = path.join(tempRoot, 'workspace');
      const knowledgePath = path.join(workspaceDir, 'knowledge');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(knowledgePath, 'not-a-directory');

      const profile = createProfile({
        profileMigrationVersion: 1,
        chats: [{
          chat_id: 'chat_error_tolerant',
          chat_type: 'single_agent',
          agent: {
            role: 'assistant',
            emoji: '🤖',
            avatar: '',
            name: 'Error Tolerant Agent',
            model: 'mock-default-model',
            workspace: workspaceDir,
            knowledge: {
              knowledgeBase: knowledgePath,
            },
            version: '1.0.0',
            source: 'ON-DEVICE',
            mcp_servers: [],
            system_prompt: { 'Base.md': 'You are helpful.', 'AGENTS.md': '' },
            skills: [],
          },
        }],
      });

      const mutated = applyProfileMigrations(profile);

      expect(mutated).toBe(true);
      expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
      expect(profile.chats[0].agent?.knowledge).toEqual({
        knowledgeBase: knowledgePath,
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('V6 — agent_ids derivation', () => {
    function singleAgentChat(name: string, source: 'ON-DEVICE' | 'IN-LIBRARY' = 'ON-DEVICE') {
      return {
        chat_id: 'chat_x',
        chat_type: 'single_agent' as const,
        agent: { name, model: 'm', source, mcp_servers: [] } as never,
      };
    }

    it('mints a stable UUID id when the inline agent has none', () => {
      const profile = createProfile({ profileMigrationVersion: 5, chats: [singleAgentChat('Kobi')] });
      applyProfileMigrations(profile);
      const mintedId = profile.chats[0].agent?.id;
      // Migration mints a name-independent UUID (never derives from the name).
      expect(mintedId).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
      expect(profile.chats[0].agent_ids).toEqual([mintedId]);
    });

    it('uses a carried agent id instead of minting', () => {
      const chat = singleAgentChat('Kobi') as { agent: { id?: string } };
      chat.agent.id = 'agent_fixed_kobi';
      const profile = createProfile({ profileMigrationVersion: 5, chats: [chat as never] });
      applyProfileMigrations(profile);
      expect(profile.chats[0].agent_ids).toEqual(['agent_fixed_kobi']);
    });

    it('mints multiple UUID ids from chat.agents', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [{
          chat_id: 'chat_m',
          chat_type: 'multi_agent',
          agents: [
            { name: 'Alpha', model: 'm', source: 'ON-DEVICE', mcp_servers: [] },
            { name: 'Beta', model: 'm', source: 'IN-LIBRARY', mcp_servers: [] },
          ],
        } as never],
      });
      applyProfileMigrations(profile);
      const ids = profile.chats[0].agent_ids ?? [];
      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
      expect(ids[1]).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
      expect(ids[0]).not.toBe(ids[1]);
      // The minted ids are written back onto the inline agents.
      expect(profile.chats[0].agents?.map((a) => a.id)).toEqual(ids);
    });

    it('preserves pre-existing agent_ids', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [{ ...singleAgentChat('Kobi'), agent_ids: ['custom-id'] } as never],
      });
      applyProfileMigrations(profile);
      expect(profile.chats[0].agent_ids).toEqual(['custom-id']);
    });

    it('leaves chats with no agent untouched', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [{ chat_id: 'empty', chat_type: 'single_agent' } as never],
      });
      applyProfileMigrations(profile);
      expect(profile.chats[0].agent_ids).toBeUndefined();
    });

    it('moves legacy inline agent workspace to the chat during V6', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [{
          ...singleAgentChat('Kobi'),
          chat_id: 'chat_workspace',
          agent: {
            name: 'Kobi',
            model: 'm',
            source: 'ON-DEVICE',
            workspace: '/legacy-chat-workspace',
            knowledge: { knowledgeBase: '/custom-knowledge' },
            mcp_servers: [],
          },
        } as never],
      });

      applyProfileMigrations(profile);

      expect(profile.chats[0].workspace).toBe('/legacy-chat-workspace');
      expect(profile.chats[0].agent?.workspace).toBeUndefined();
      expect(profile.chats[0].agent?.knowledge?.knowledgeBase).toBe('/custom-knowledge');
    });
  });

  describe('V6 (b) — primaryAgent name → primaryChat chat_id', () => {
    function chatWithAgent(chatId: string, agentName: string) {
      return {
        chat_id: chatId,
        chat_type: 'single_agent' as const,
        agent: { name: agentName, model: 'm', source: 'ON-DEVICE', mcp_servers: [] } as never,
      };
    }

    it('resolves the legacy primaryAgent name to its owning chat_id', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [chatWithAgent('chat_a', 'Agent A'), chatWithAgent('chat_b', 'Agent B')],
      });
      (profile as { primaryAgent?: string }).primaryAgent = 'Agent B';

      applyProfileMigrations(profile);

      expect(profile.primaryChat).toBe('chat_b');
      // The legacy field is dropped once migrated.
      expect((profile as { primaryAgent?: string }).primaryAgent).toBeUndefined();
    });

    it('leaves primaryChat unset when the legacy name matches no chat', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [chatWithAgent('chat_a', 'Agent A')],
      });
      (profile as { primaryAgent?: string }).primaryAgent = 'Ghost Agent';

      applyProfileMigrations(profile);

      expect(profile.primaryChat).toBeUndefined();
      expect((profile as { primaryAgent?: string }).primaryAgent).toBeUndefined();
    });

    it('drops an empty legacy primaryAgent without setting primaryChat', () => {
      const profile = createProfile({
        profileMigrationVersion: 5,
        chats: [chatWithAgent('chat_a', 'Agent A')],
      });
      (profile as { primaryAgent?: string }).primaryAgent = '';

      applyProfileMigrations(profile);

      expect(profile.primaryChat).toBeUndefined();
      expect((profile as { primaryAgent?: string }).primaryAgent).toBeUndefined();
    });

    it('does not re-run the primaryChat conversion for profiles already at the current version', () => {
      const profile = createProfile({ profileMigrationVersion: PROFILE_MIGRATION_VERSION });
      (profile as { primaryAgent?: string }).primaryAgent = 'Agent A';

      applyProfileMigrations(profile);

      // Already migrated: the legacy field is left as-is (not touched by the migration).
      expect((profile as { primaryAgent?: string }).primaryAgent).toBe('Agent A');
    });
  });
});
