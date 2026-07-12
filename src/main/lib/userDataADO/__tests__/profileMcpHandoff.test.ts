import { describe, it, expect, beforeEach, vi } from 'vitest';

const { errorSpy } = vi.hoisted(() => ({ errorSpy: vi.fn() }));

const { mcpMock, skillsMock, hooksMock } = vi.hoisted(() => ({
  mcpMock: { commitResolvedServers: vi.fn(async () => {}) },
  skillsMock: {
    commitResolvedSkills: vi.fn(async () => {}),
    loadForAlias: vi.fn(async () => ({ skills: [] as SkillConfig[], needsProfileRewrite: false })),
  },
  hooksMock: {
    commitResolvedHooks: vi.fn(async () => {}),
    loadForAlias: vi.fn(async () => ({ hooks: [] as HookDefinition[], needsProfileRewrite: false })),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: errorSpy,
    debug: vi.fn(),
    updateConfig: vi.fn(),
  }),
}));

vi.mock('../mcpConfigManager', () => ({ mcpConfigManager: mcpMock }));
vi.mock('../skillsConfigManager', () => ({ skillsConfigManager: skillsMock }));
vi.mock('../hooksConfigManager', () => ({ hooksConfigManager: hooksMock }));

import {
  tryCommitMcpServers,
  tryCommitSkills,
  tryCommitHooks,
  loadSkillRegistryForProfile,
  loadHookRegistryForProfile,
  fingerprintProfileForDirtyCheck,
} from '../profileMcpHandoff';
import type { HookDefinition, SkillConfig, McpServerConfig, ProfileV2 } from '../types/profile';

describe('profileMcpHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpMock.commitResolvedServers.mockResolvedValue(undefined);
    skillsMock.commitResolvedSkills.mockResolvedValue(undefined);
    skillsMock.loadForAlias.mockResolvedValue({ skills: [], needsProfileRewrite: false });
    hooksMock.commitResolvedHooks.mockResolvedValue(undefined);
    hooksMock.loadForAlias.mockResolvedValue({ hooks: [], needsProfileRewrite: false });
  });

  describe('tryCommitMcpServers', () => {
    it('returns true and forwards the servers on success', async () => {
      const servers = [{ id: 's1' }] as unknown as McpServerConfig[];
      const ok = await tryCommitMcpServers('alice', servers, 'op', 'msg');
      expect(ok).toBe(true);
      expect(mcpMock.commitResolvedServers).toHaveBeenCalledWith('alice', servers);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns false and logs when the commit throws', async () => {
      mcpMock.commitResolvedServers.mockRejectedValueOnce(new Error('disk full'));
      const ok = await tryCommitMcpServers('alice', [], 'writeProfileToFile', 'mcp failed');
      expect(ok).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('mcp failed', 'writeProfileToFile', {
        alias: 'alice',
        error: 'Error: disk full',
      });
    });
  });

  describe('tryCommitSkills', () => {
    it('returns true and forwards the skills on success', async () => {
      const skills = [{ id: 'k1' }] as unknown as SkillConfig[];
      const ok = await tryCommitSkills('bob', skills, 'op', 'msg');
      expect(ok).toBe(true);
      expect(skillsMock.commitResolvedSkills).toHaveBeenCalledWith('bob', skills);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns false and logs when the commit throws', async () => {
      skillsMock.commitResolvedSkills.mockRejectedValueOnce(new Error('locked'));
      const ok = await tryCommitSkills('bob', [], 'writeProfileToFile', 'skills failed');
      expect(ok).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('skills failed', 'writeProfileToFile', {
        alias: 'bob',
        error: 'Error: locked',
      });
    });
  });

  describe('tryCommitHooks', () => {
    it('returns true and forwards the hooks on success', async () => {
      const hooks = [{ id: 'h1' }] as unknown as HookDefinition[];
      const ok = await tryCommitHooks('carol', hooks, 'op', 'msg');
      expect(ok).toBe(true);
      expect(hooksMock.commitResolvedHooks).toHaveBeenCalledWith('carol', hooks);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns false and logs when the commit throws', async () => {
      hooksMock.commitResolvedHooks.mockRejectedValueOnce(new Error('av lock'));
      const ok = await tryCommitHooks('carol', [], 'writeProfileToFile', 'hooks failed');
      expect(ok).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('hooks failed', 'writeProfileToFile', {
        alias: 'carol',
        error: 'Error: av lock',
      });
    });
  });

  describe('loadSkillRegistryForProfile', () => {
    it('returns the resolved registry on success', async () => {
      const result = { skills: [{ id: 'k1' }] as unknown as SkillConfig[], needsProfileRewrite: true };
      skillsMock.loadForAlias.mockResolvedValueOnce(result);
      const out = await loadSkillRegistryForProfile('bob', { skills: [] });
      expect(out).toEqual(result);
      expect(skillsMock.loadForAlias).toHaveBeenCalledWith('bob', { skills: [] });
    });

    it('returns null and logs when loadForAlias throws', async () => {
      skillsMock.loadForAlias.mockRejectedValueOnce(new Error('boom'));
      const out = await loadSkillRegistryForProfile('bob', { skills: [] });
      expect(out).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        '[ProfileCacheManager] Failed to persist skills.json during profile load; keeping existing profile.json intact',
        'readProfileFromFile',
        { alias: 'bob', error: 'Error: boom' },
      );
    });
  });

  describe('loadHookRegistryForProfile', () => {
    it('returns the resolved registry on success', async () => {
      const result = { hooks: [{ id: 'h1' }] as unknown as HookDefinition[], needsProfileRewrite: true };
      hooksMock.loadForAlias.mockResolvedValueOnce(result);
      const out = await loadHookRegistryForProfile('carol', { hooks: [] });
      expect(out).toEqual(result);
      expect(hooksMock.loadForAlias).toHaveBeenCalledWith('carol', { hooks: [] });
    });

    it('returns null and logs when loadForAlias throws', async () => {
      hooksMock.loadForAlias.mockRejectedValueOnce(new Error('boom'));
      const out = await loadHookRegistryForProfile('carol', { hooks: [] });
      expect(out).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        '[ProfileCacheManager] Failed to persist hooks.json during profile load; keeping existing profile.json intact',
        'readProfileFromFile',
        { alias: 'carol', error: 'Error: boom' },
      );
    });
  });

  describe('fingerprintProfileForDirtyCheck', () => {
    it('strips mcp_servers, skills, hooks and updatedAt but keeps hooksEnabled', () => {
      const profile = {
        alias: 'dave',
        hooksEnabled: true,
        mcp_servers: [{ id: 's1' }],
        skills: [{ id: 'k1' }],
        hooks: [{ id: 'h1' }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as unknown as Partial<ProfileV2>;

      const fp = fingerprintProfileForDirtyCheck(profile);
      const parsed = JSON.parse(fp);

      expect(parsed).toEqual({ alias: 'dave', hooksEnabled: true });
      expect(parsed.mcp_servers).toBeUndefined();
      expect(parsed.skills).toBeUndefined();
      expect(parsed.hooks).toBeUndefined();
      expect(parsed.updatedAt).toBeUndefined();
    });

    it('does not mutate the input profile', () => {
      const profile = {
        alias: 'erin',
        hooks: [{ id: 'h1' }],
        updatedAt: 'x',
      } as unknown as Partial<ProfileV2>;
      fingerprintProfileForDirtyCheck(profile);
      expect(profile.hooks).toEqual([{ id: 'h1' }]);
      expect(profile.updatedAt).toBe('x');
    });
  });
});
