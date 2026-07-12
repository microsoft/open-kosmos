/**
 * Unit tests for ManageAgentsFacade
 */
// @ts-nocheck

vi.mock('../../createAgentFromConfigTool', () => ({
  CreateAgentFromConfigTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Created', agent_name: 'Test' }),
  },
}));

vi.mock('../../updateAgentTool', () => ({
  UpdateAgentTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Updated' }),
  },
}));

vi.mock('../../getAgentStatusTool', () => ({
  GetAgentStatusTool: {
    execute: vi.fn().mockResolvedValue({ success: true, status: 'Added' }),
  },
}));

vi.mock('../../listAgentsTool', () => ({
  ListAgentsTool: {
    execute: vi.fn().mockResolvedValue({ success: true, agents: ['Bot1', 'Bot2'], count: 2 }),
  },
}));

vi.mock('../../setPrimaryAgentTool', () => ({
  SetPrimaryAgentTool: {
    execute: vi.fn().mockResolvedValue({ success: true, primaryAgent: 'Bot1' }),
  },
}));

vi.mock('../../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    currentUserAlias: 'test-user',
    getAllChatConfigs: vi.fn().mockReturnValue([
      {
        chat_id: 'chat-1',
        agent: {
          name: 'Bot1',
          source: 'ON-DEVICE',
          version: '1.0.0',
          system_prompt: { 'Base.md': 'identity', 'AGENTS.md': 'context' },
          zero_states: {
            greeting: 'Old greeting',
            quick_starts: [{ id: 'old-card', title: 'Old', description: 'Old card', prompt: 'old prompt' }],
          },
        },
      },
      { chat_id: 'chat-2', agent: { name: 'Bot2', source: 'IN-LIBRARY', version: '2.0.0' } },
    ]),
    deleteChatConfig: vi.fn().mockResolvedValue(true),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManageAgentsFacade } from '../manageAgentsFacade';
import { CreateAgentFromConfigTool } from '../../createAgentFromConfigTool';
import { UpdateAgentTool } from '../../updateAgentTool';
import { ListAgentsTool } from '../../listAgentsTool';
import { SetPrimaryAgentTool } from '../../setPrimaryAgentTool';
import { GetAgentStatusTool } from '../../getAgentStatusTool';
import { profileCacheManager } from '../../../../userDataADO/profileCacheManager';

describe('ManageAgentsFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses secondary agents when resolving update metadata', async () => {
    vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValueOnce([
      {
        chat_id: 'chat-multi',
        agents: [
          { name: 'Primary', source: 'ON-DEVICE', version: '1.0.0' },
          { name: 'Secondary', source: 'IN-LIBRARY', version: '2.0.0' },
        ],
      },
    ] as any);

    await ManageAgentsFacade.execute({
      action: 'update',
      name: 'Secondary',
      model: 'gpt-4o',
    });

    expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
      agent_config: expect.objectContaining({
        name: 'Secondary',
      }),
    });
  });

  describe('getDefinition()', () => {
    it('returns correct tool name', () => {
      const def = ManageAgentsFacade.getDefinition();
      expect(def.name).toBe('manage_agents');
      expect(def.inputSchema.required).toEqual(['action']);
      expect((def.inputSchema as any).properties.workspace).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('rejects invalid action', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'fly' } as any);
      expect(result.success).toBe(false);
    });

    it('rejects create without name', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'create' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('name');
    });

    it('allows list without name', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'list' });
      expect(result.success).toBe(true);
    });

    it('rejects workspace instead of accepting a no-op agent-owned workspace', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        workspace: '/tmp/ws',
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('workspace');
      expect(CreateAgentFromConfigTool.execute).not.toHaveBeenCalled();
    });
  });

  describe('action=create, direct (emoji)', () => {
    it('sets emoji when provided', async () => {
      await ManageAgentsFacade.execute({ action: 'create', name: 'Bot', emoji: '🤖' });
      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: '🤖' }),
      );
    });
  });

  describe('action=create, direct', () => {
    it('converts mcp_servers strings to objects', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        mcp_servers: ['github', 'bing'],
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bot',
          mcp_servers: [
            { name: 'github', tools: [] },
            { name: 'bing', tools: [] },
          ],
        }),
      );
    });

    it('merges mcp_tool_filter into mcp_servers', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        mcp_servers: ['github', 'bing'],
        mcp_tool_filter: { github: ['search_repos', 'get_file'] },
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp_servers: [
            { name: 'github', tools: ['search_repos', 'get_file'] },
            { name: 'bing', tools: [] },
          ],
        }),
      );
    });

    it('maps knowledge_base to knowledgeBase', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        knowledge_base: '/data/kb',
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeBase: '/data/kb' }),
      );
    });

    it('sets source=ON-DEVICE and version=1.0.0', async () => {
      await ManageAgentsFacade.execute({ action: 'create', name: 'Bot' });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'ON-DEVICE', version: '1.0.0' }),
      );
    });

    it('builds zero_states from greeting and quick_starts', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        greeting: 'Hello!',
        quick_starts: [{ title: 'T', description: 'D', prompt: 'P' }],
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          zero_states: {
            greeting: 'Hello!',
            quick_starts: [
              expect.objectContaining({ title: 'T', description: 'D', prompt: 'P', id: expect.any(String) }),
            ],
          },
        }),
      );
    });
  });

  describe('action=update', () => {
    it('returns error when currentUserAlias is null', async () => {
      (profileCacheManager as any).currentUserAlias = null;
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        model: 'gpt-4o',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('No current user session');
      (profileCacheManager as any).currentUserAlias = 'test-user';
    });

    it('maps all optional fields for ON-DEVICE update', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        knowledge_base: '/data/kb',
        mcp_servers: ['bing'],
        greeting: 'Hi!',
        quick_starts: [{ title: 'T', description: 'D', prompt: 'P' }],
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          knowledgeBase: '/data/kb',
          mcp_servers: [{ name: 'bing', tools: [] }],
          zero_states: expect.objectContaining({ greeting: 'Hi!' }),
        }),
      });
    });

    it('defaults mcp_servers to merge mode on update (additive intent)', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        mcp_servers: ['bing'],
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          mcp_servers: [{ name: 'bing', tools: [] }],
          mcp_servers_mode: 'merge',
        }),
      });
    });

    it('updates greeting without dropping quick_starts', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        greeting: 'New greeting',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          zero_states: {
            greeting: 'New greeting',
            quick_starts: [{ id: 'old-card', title: 'Old', description: 'Old card', prompt: 'old prompt' }],
          },
        }),
      });
    });

    it('merges quick_starts by default during update', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        quick_starts: [{ title: 'New', description: 'New card', prompt: 'new prompt' }],
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          zero_states: expect.objectContaining({
            quick_starts: [
              { id: 'old-card', title: 'Old', description: 'Old card', prompt: 'old prompt' },
              expect.objectContaining({ title: 'New', description: 'New card', prompt: 'new prompt', id: expect.any(String) }),
            ],
          }),
        }),
      });
    });

    it('replaces quick_starts when quick_starts_mode is replace', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        quick_starts: [{ title: 'Only', description: 'Only card', prompt: 'only prompt' }],
        quick_starts_mode: 'replace',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          zero_states: expect.objectContaining({
            quick_starts: [
              expect.objectContaining({ title: 'Only', description: 'Only card', prompt: 'only prompt', id: expect.any(String) }),
            ],
          }),
        }),
      });
    });

    it('updates Project Context without overriding Agent Identity', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        project_context_prompt: 'new context',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          system_prompt: { 'Base.md': 'identity', 'AGENTS.md': 'new context' },
        }),
      });
    });

    it('treats legacy string system_prompt as an Agent Identity-only update', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        system_prompt: 'new identity',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          system_prompt: { 'Base.md': 'new identity', 'AGENTS.md': 'context' },
        }),
      });
    });

    it('threads mcp_servers_mode=replace through to the tool', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        mcp_servers: ['bing'],
        mcp_servers_mode: 'replace',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          mcp_servers_mode: 'replace',
        }),
      });
    });

    it('forwards an explicit empty mcp_servers with replace mode (clear intent)', async () => {
      // Regression guard: a truthiness check would drop `[]` and silently keep
      // existing servers. `!== undefined` must let the clear-all intent through.
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        mcp_servers: [],
        mcp_servers_mode: 'replace',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          mcp_servers: [],
          mcp_servers_mode: 'replace',
        }),
      });
    });

    it('defaults skills to merge mode and threads skills_mode=replace', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        skills: ['code-review'],
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          skills: ['code-review'],
          skills_mode: 'merge',
        }),
      });

      vi.mocked(UpdateAgentTool.execute).mockClear();

      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        skills: ['code-review'],
        skills_mode: 'replace',
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          skills: ['code-review'],
          skills_mode: 'replace',
        }),
      });
    });

    it('defaults hooks to merge mode and threads hooks_mode=replace', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        hooks: ['hook-a'],
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          hooks: ['hook-a'],
          hooks_mode: 'merge',
        }),
      });

      vi.mocked(UpdateAgentTool.execute).mockClear();

      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        hooks: ['hook-a'],
        hooks_mode: 'replace',
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          hooks: ['hook-a'],
          hooks_mode: 'replace',
        }),
      });
    });

    it('updates an on-device agent without synthesizing provenance fields', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        model: 'claude-sonnet-4-20250514',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot1',
          model: 'claude-sonnet-4-20250514',
        }),
      });
    });

    it('treats legacy library metadata as inert during update', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        model: 'gpt-4o',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot2',
          model: 'gpt-4o',
        }),
      });
    });

    it('returns error for non-existent agent', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Ghost',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('allows locally editing fields on an agent with legacy library metadata', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        emoji: '🤖',
        system_prompt: 'new prompt',
        project_context_prompt: 'new context',
      });
      expect(result.success).toBe(true);
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot2',
          emoji: '🤖',
          system_prompt: {
            'Base.md': 'new prompt',
            'AGENTS.md': 'new context',
          },
        }),
      });
    });

  });

  describe('getCurrentUserAlias catch', () => {
    it('returns null when currentUserAlias getter throws', async () => {
      Object.defineProperty(profileCacheManager, 'currentUserAlias', {
        get: () => { throw new Error('access error'); },
        configurable: true,
      });
      const result = await ManageAgentsFacade.execute({ action: 'update', name: 'Bot1' });
      expect(result.success).toBe(false);
      // Restore
      Object.defineProperty(profileCacheManager, 'currentUserAlias', {
        get: () => 'test-user',
        configurable: true,
      });
    });
  });

  describe('action=remove (removed capability)', () => {
    it('is rejected as an invalid action and never deletes a chat', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'remove' as never, name: 'Bot1' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid action');
      expect(profileCacheManager.deleteChatConfig).not.toHaveBeenCalled();
    });
  });

  describe('action=list', () => {
    it('delegates to ListAgentsTool', async () => {
      await ManageAgentsFacade.execute({ action: 'list' });
      expect(ListAgentsTool.execute).toHaveBeenCalled();
    });
  });

  describe('action=set_primary', () => {
    it('maps name to agent_name', async () => {
      await ManageAgentsFacade.execute({ action: 'set_primary', name: 'Bot1' });
      expect(SetPrimaryAgentTool.execute).toHaveBeenCalledWith({ agent_name: 'Bot1' });
    });
  });

  describe('action=create, direct – all optional fields', () => {
    it('sets role, model, system_prompt, skills when provided', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'FullBot',
        role: 'Engineer',
        model: 'gpt-4o',
        system_prompt: 'You are helpful',
        skills: ['skill-a'],
      });
      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'Engineer',
          model: 'gpt-4o',
          system_prompt: { 'Base.md': 'You are helpful', 'AGENTS.md': '' },
          skills: ['skill-a'],
        }),
      );
    });
  });

  describe('action=update – optional field branches', () => {
    it('sets role and model on update', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        role: 'NewRole',
        model: 'gpt-4o',
        system_prompt: 'New prompt',
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          role: 'NewRole',
          model: 'gpt-4o',
          system_prompt: { 'Base.md': 'New prompt', 'AGENTS.md': 'context' },
        }),
      });
    });
  });

  describe('legacy metadata update compatibility', () => {
    it('allows updating only emoji', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        emoji: '🔥',
      });
      expect(result.success).toBe(true);
    });

    it('allows updating only system_prompt', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        system_prompt: 'new prompt',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('additional direct create and update coverage', () => {
    it('createDirect: sets all optional fields when provided (L273-277)', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        role: 'Helper',
        model: 'gpt-4o',
        system_prompt: 'be nice',
        skills: ['code-review'],
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'Helper',
          model: 'gpt-4o',
          system_prompt: { 'Base.md': 'be nice', 'AGENTS.md': '' },
          skills: ['code-review'],
        }),
      );
    });

    it('update: sets emoji/role/system_prompt true-branches on ON-DEVICE (L348-352)', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        emoji: '🎯',
        role: 'New Role',
        system_prompt: 'new sys',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          emoji: '🎯',
          role: 'New Role',
          system_prompt: { 'Base.md': 'new sys', 'AGENTS.md': 'context' },
        }),
      });
    });

    it('update: builds zero_states from quick_starts only (buildZeroStates greeting-undefined branch, L495)', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        quick_starts: [{ title: 'T', description: 'D', prompt: 'P' }],
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          zero_states: {
            greeting: 'Old greeting',
            quick_starts: [
              { id: 'old-card', title: 'Old', description: 'Old card', prompt: 'old prompt' },
              expect.objectContaining({ title: 'T', description: 'D', prompt: 'P', id: expect.any(String) }),
            ],
          },
        }),
      });
    });

  });
});
