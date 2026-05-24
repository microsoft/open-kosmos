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
    const profile = createProfile({ profileMigrationVersion: 1 });

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
          version: '1.0.0',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: 'You are helpful.',
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
    expect(profile.profileMigrationVersion).toBe(PROFILE_MIGRATION_VERSION);
  });

  it('skips migration when profile is already at current version', () => {
    const profile = createProfile({
      profileMigrationVersion: PROFILE_MIGRATION_VERSION,
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
          system_prompt: 'You are helpful.',
          skills: [],
        },
      }],
    });

    const mutated = applyProfileMigrations(profile);

    expect(mutated).toBe(false);
    expect(profile.chats[0].agent?.knowledge).toEqual({
      knowledgeBase: '/tmp/workspace/chat_2/knowledge',
    });
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
            system_prompt: 'You are helpful.',
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
            system_prompt: 'You are helpful.',
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
});
