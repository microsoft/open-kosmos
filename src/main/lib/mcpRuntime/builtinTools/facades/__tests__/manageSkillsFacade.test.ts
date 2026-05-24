/**
 * Unit tests for ManageSkillsFacade
 */

vi.mock('../../../../skill/installAndActivateSkill', () => ({
  installAndActivateSkill: vi.fn().mockResolvedValue({ success: true, message: 'Installed' }),
}));

vi.mock('../../applySkillToAgentsTool', () => ({
  ApplySkillToAgentsTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Applied' }),
  },
}));

vi.mock('../../uninstallSkillsTool', () => ({
  UninstallSkillsTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Uninstalled 1 skill(s)', uninstalled_count: 1, uninstalled_skills: ['test-skill'] }),
  },
}));

vi.mock('../../removeSkillsFromAgentsTool', () => ({
  RemoveSkillsFromAgentsTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Removed' }),
  },
}));

vi.mock('../../../../userDataADO', () => ({
  profileCacheManager: {
    currentUserAlias: 'test-user',
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManageSkillsFacade } from '../manageSkillsFacade';
import { installAndActivateSkill } from '../../../../skill/installAndActivateSkill';
import { ApplySkillToAgentsTool } from '../../applySkillToAgentsTool';
import { UninstallSkillsTool } from '../../uninstallSkillsTool';
import { RemoveSkillsFromAgentsTool } from '../../removeSkillsFromAgentsTool';

describe('ManageSkillsFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinition()', () => {
    it('returns correct tool name and schema', () => {
      const def = ManageSkillsFacade.getDefinition();
      expect(def.name).toBe('manage_skills');
      expect(def.inputSchema.required).toEqual(['action', 'skill_names']);
    });
  });

  describe('validation', () => {
    it('rejects missing action', async () => {
      const result = await ManageSkillsFacade.execute({ skill_names: ['x'] } as any);
      expect(result.success).toBe(false);
      expect(result.message).toContain('action');
    });

    it('rejects invalid action', async () => {
      const result = await ManageSkillsFacade.execute({ action: 'fly', skill_names: ['x'] } as any);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid action');
    });

    it('rejects empty skill_names', async () => {
      const result = await ManageSkillsFacade.execute({ action: 'install', skill_names: [] });
      expect(result.success).toBe(false);
      expect(result.message).toContain('skill_names');
    });

    it('rejects missing skill_names', async () => {
      const result = await ManageSkillsFacade.execute({ action: 'install' } as any);
      expect(result.success).toBe(false);
    });
  });

  describe('action=install (error cases)', () => {
    it('returns partial success when one skill install throws', async () => {
      vi.mocked(installAndActivateSkill)
        .mockResolvedValueOnce({ success: true, message: 'Installed' } as any)
        .mockRejectedValueOnce(new Error('network fail'));

      const result = await ManageSkillsFacade.execute({
        action: 'install',
        skill_names: ['good-skill', 'bad-skill'],
        source: 'device',
        path: '/tmp/skills',
      });

      // 1/2 succeeded → success=true (successCount > 0), but bad-skill has error
      const results = (result as any).results;
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].message).toContain('network fail');
    });
  });

  describe('action=uninstall (error cases)', () => {
    it('propagates error when UninstallSkillsTool throws', async () => {
      vi.mocked(UninstallSkillsTool.execute).mockRejectedValueOnce(new Error('uninstall fail'));
      await expect(
        ManageSkillsFacade.execute({
          action: 'uninstall',
          skill_names: ['web-search'],
        }),
      ).rejects.toThrow('uninstall fail');
    });
  });

  describe('action=bind (error cases)', () => {
    it('returns partial failure when ApplySkillToAgentsTool throws for one skill', async () => {
      vi.mocked(ApplySkillToAgentsTool.execute)
        .mockResolvedValueOnce({ success: true, message: 'Applied' } as any)
        .mockRejectedValueOnce(new Error('bind fail'));

      const result = await ManageSkillsFacade.execute({
        action: 'bind',
        skill_names: ['good-skill', 'bad-skill'],
        agent_names: ['Bot1'],
      });

      const results = (result as any).results;
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].message).toContain('bind fail');
    });
  });

  describe('action=install', () => {
    it('installs from device with path', async () => {
      await ManageSkillsFacade.execute({
        action: 'install',
        skill_names: ['custom'],
        source: 'device',
        path: '/tmp/skill.zip',
      });

      expect(installAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { type: 'device-path', value: '/tmp/skill.zip' },
        }),
      );
    });

    it('rejects device source without path', async () => {
      const result = await ManageSkillsFacade.execute({
        action: 'install',
        skill_names: ['custom'],
        source: 'device',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('path');
    });

    it('installs multiple skills from device', async () => {
      await ManageSkillsFacade.execute({
        action: 'install',
        skill_names: ['a', 'b', 'c'],
        source: 'device',
        path: '/tmp/skills',
      });

      expect(installAndActivateSkill).toHaveBeenCalledTimes(3);
    });
  });

  describe('action=uninstall', () => {
    it('delegates to UninstallSkillsTool', async () => {
      await ManageSkillsFacade.execute({
        action: 'uninstall',
        skill_names: ['web-search'],
      });

      expect(UninstallSkillsTool.execute).toHaveBeenCalledWith({
        skill_names: ['web-search'],
      });
    });
  });

  describe('action=bind', () => {
    it('delegates to ApplySkillToAgentsTool per skill', async () => {
      await ManageSkillsFacade.execute({
        action: 'bind',
        skill_names: ['web-search', 'code-review'],
        agent_names: ['Bot1'],
      });

      expect(ApplySkillToAgentsTool.execute).toHaveBeenCalledTimes(2);
      expect(ApplySkillToAgentsTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ skill_name: 'web-search', agent_names: ['Bot1'] }),
      );
    });

    it('maps all_agents to apply_to_all', async () => {
      await ManageSkillsFacade.execute({
        action: 'bind',
        skill_names: ['web-search'],
        all_agents: true,
      });

      expect(ApplySkillToAgentsTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ skill_name: 'web-search', apply_to_all: true }),
      );
    });

    it('defaults to current agent when no targeting', async () => {
      await ManageSkillsFacade.execute({
        action: 'bind',
        skill_names: ['web-search'],
      });

      const callArgs = (ApplySkillToAgentsTool.execute as any).mock.calls[0][0];
      expect(callArgs.agent_names).toBeUndefined();
      expect(callArgs.apply_to_all).toBeUndefined();
    });
  });

  describe('action=unbind', () => {
    it('delegates to RemoveSkillsFromAgentsTool', async () => {
      await ManageSkillsFacade.execute({
        action: 'unbind',
        skill_names: ['web-search'],
        agent_names: ['Bot1'],
      });

      expect(RemoveSkillsFromAgentsTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ skill_names: ['web-search'], agent_names: ['Bot1'] }),
      );
    });

    it('maps all_agents to remove_from_all', async () => {
      await ManageSkillsFacade.execute({
        action: 'unbind',
        skill_names: ['web-search'],
        all_agents: true,
      });

      expect(RemoveSkillsFromAgentsTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ remove_from_all: true }),
      );
    });
  });
});
