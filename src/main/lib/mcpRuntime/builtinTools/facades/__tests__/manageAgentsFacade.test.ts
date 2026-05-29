/**
 * Unit tests for ManageAgentsFacade
 */

vi.mock('../../getAgentTemplateFromLibraryTool', () => ({
  GetAgentTemplateFromLibraryTool: {
    execute: vi.fn().mockResolvedValue({
      success: true,
      config: {
        name: 'Research Agent',
        version: '1.0.0',
        description: 'A research agent',
        configuration: {
          name: 'Research Agent',
          model: 'gpt-4',
          role: 'Researcher',
          mcp_servers: [{ name: 'bing', tools: [] }],
          context_enhancement: {
            search_memory: { enabled: true },
            generate_memory: { enabled: true },
          },
        },
      },
    }),
  },
}));

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
      { chat_id: 'chat-1', agent: { name: 'Bot1', source: 'ON-DEVICE', version: '1.0.0' } },
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

  describe('getDefinition()', () => {
    it('returns correct tool name', () => {
      const def = ManageAgentsFacade.getDefinition();
      expect(def.name).toBe('manage_agents');
      expect(def.inputSchema.required).toEqual(['action']);
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

    it('expands memory_enabled=true to full context_enhancement', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        memory_enabled: true,
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          context_enhancement: {
            search_memory: { enabled: true, semantic_similarity_threshold: 0.7, semantic_top_n: 5 },
            generate_memory: { enabled: true },
          },
        }),
      );
    });

    it('expands memory_enabled=false', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Bot',
        memory_enabled: false,
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          context_enhancement: {
            search_memory: { enabled: false },
            generate_memory: { enabled: false },
          },
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
            quick_starts: [{ title: 'T', description: 'D', prompt: 'P' }],
          },
        }),
      );
    });
  });

  describe('action=create, from_library', () => {
    it('returns error when library template not found', async () => {
      const { GetAgentTemplateFromLibraryTool } = await import('../../getAgentTemplateFromLibraryTool');
      vi.mocked(GetAgentTemplateFromLibraryTool.execute).mockResolvedValueOnce({
        success: false,
        message: 'Not found',
      } as any);

      const result = await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Unknown Agent',
        from_library: true,
      });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe('LIBRARY_FETCH_FAILED');
    });

    it('uses template mcp_servers, context_enhancement, and zero_states when no override provided', async () => {
      const { GetAgentTemplateFromLibraryTool } = await import('../../getAgentTemplateFromLibraryTool');
      vi.mocked(GetAgentTemplateFromLibraryTool.execute).mockResolvedValueOnce({
        success: true,
        config: {
          name: 'Research Agent',
          version: '1.0.0',
          description: 'A research agent',
          configuration: {
            name: 'Research Agent',
            model: 'gpt-4',
            role: 'Researcher',
            mcp_servers: [{ name: 'bing', tools: [] }],
            context_enhancement: {
              search_memory: { enabled: true },
              generate_memory: { enabled: true },
            },
          },
        },
      } as any);

      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Research Agent',
        from_library: true,
        knowledge_base: '/data/kb',
        greeting: 'Hello!',
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp_servers: [{ name: 'bing', tools: [] }],
          context_enhancement: expect.objectContaining({ search_memory: { enabled: true } }),
          knowledgeBase: '/data/kb',
          zero_states: expect.objectContaining({ greeting: 'Hello!' }),
        }),
      );
    });

    it('inherits context_enhancement from template when memory_enabled not specified', async () => {
      const { GetAgentTemplateFromLibraryTool } = await import('../../getAgentTemplateFromLibraryTool');
      vi.mocked(GetAgentTemplateFromLibraryTool.execute).mockResolvedValueOnce({
        success: true,
        config: {
          name: 'Research Agent',
          version: '1.0.0',
          description: 'desc',
          configuration: {
            name: 'Research Agent',
            model: 'gpt-4',
            role: 'Researcher',
            context_enhancement: {
              search_memory: { enabled: true },
              generate_memory: { enabled: false },
            },
          },
        },
      } as any);

      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Research Agent',
        from_library: true,
        // no memory_enabled override
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          context_enhancement: { search_memory: { enabled: true }, generate_memory: { enabled: false } },
        }),
      );
    });

    it('uses template zero_states when no greeting override provided', async () => {
      const { GetAgentTemplateFromLibraryTool } = await import('../../getAgentTemplateFromLibraryTool');
      vi.mocked(GetAgentTemplateFromLibraryTool.execute).mockResolvedValueOnce({
        success: true,
        config: {
          name: 'Research Agent',
          version: '1.0.0',
          description: 'A research agent',
          configuration: {
            name: 'Research Agent',
            model: 'gpt-4',
            role: 'Researcher',
            zero_states: { greeting: 'Template greeting', quick_starts: [] },
            avatar: 'https://example.com/avatar.png',
          },
        },
      } as any);

      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Research Agent',
        from_library: true,
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          zero_states: { greeting: 'Template greeting', quick_starts: [] },
          avatar: 'https://example.com/avatar.png',
        }),
      );
    });

    it('overrides context_enhancement when memory_enabled is provided with from_library', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Research Agent',
        from_library: true,
        memory_enabled: false,
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          context_enhancement: {
            search_memory: { enabled: false },
            generate_memory: { enabled: false },
          },
        }),
      );
    });

    it('fetches template and applies overrides', async () => {
      await ManageAgentsFacade.execute({
        action: 'create',
        name: 'Research Agent',
        from_library: true,
        model: 'gpt-4o',
        mcp_servers: ['bing', 'github'],
      });

      expect(CreateAgentFromConfigTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Research Agent',
          model: 'gpt-4o', // overridden
          role: 'Researcher', // from template
          mcp_servers: [
            { name: 'bing', tools: [] },
            { name: 'github', tools: [] },
          ], // overridden
          source: 'IN-LIBRARY',
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
        memory_enabled: true,
        greeting: 'Hi!',
        quick_starts: [{ title: 'T', description: 'D', prompt: 'P' }],
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          knowledgeBase: '/data/kb',
          mcp_servers: [{ name: 'bing', tools: [] }],
          context_enhancement: expect.objectContaining({ search_memory: { enabled: true, semantic_similarity_threshold: 0.7, semantic_top_n: 5 } }),
          zero_states: expect.objectContaining({ greeting: 'Hi!' }),
        }),
      });
    });

    it('auto-increments version for ON-DEVICE agent', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot1',
        model: 'claude-sonnet-4-20250514',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot1',
          model: 'claude-sonnet-4-20250514',
          version: '1.0.1',
          source: 'ON-DEVICE',
        }),
      });
    });

    it('keeps version for IN-LIBRARY agent', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        model: 'gpt-4o',
      });

      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot2',
          version: '2.0.0',
          source: 'IN-LIBRARY',
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

    it('rejects modifying read-only fields on IN-LIBRARY agent', async () => {
      const result = await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        emoji: '🤖',
        system_prompt: 'new prompt',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('read-only');
      expect(result.message).toContain('emoji (avatar)');
      expect(result.message).toContain('system_prompt');
      expect(UpdateAgentTool.execute).not.toHaveBeenCalled();
    });

    it('allows modifying non-read-only fields on IN-LIBRARY agent', async () => {
      await ManageAgentsFacade.execute({
        action: 'update',
        name: 'Bot2',
        model: 'gpt-4o-mini',
        skills: ['code-review'],
      });
      expect(UpdateAgentTool.execute).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({
          name: 'Bot2',
          model: 'gpt-4o-mini',
          skills: ['code-review'],
          source: 'IN-LIBRARY',
          version: '2.0.0',
        }),
      });
    });
  });

  describe('action=remove (error cases)', () => {
    it('returns error when currentUserAlias is null', async () => {
      const original = (profileCacheManager as any).currentUserAlias;
      (profileCacheManager as any).currentUserAlias = null;
      const result = await ManageAgentsFacade.execute({ action: 'remove', name: 'Bot1' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('No current user session');
      (profileCacheManager as any).currentUserAlias = original;
    });

    it('returns error when deleteChatConfig throws', async () => {
      vi.mocked(profileCacheManager.deleteChatConfig).mockRejectedValueOnce(new Error('DB error'));
      const result = await ManageAgentsFacade.execute({ action: 'remove', name: 'Bot1' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('DB error');
    });
  });

  describe('getCurrentUserAlias catch', () => {
    it('returns null when currentUserAlias getter throws', async () => {
      Object.defineProperty(profileCacheManager, 'currentUserAlias', {
        get: () => { throw new Error('access error'); },
        configurable: true,
      });
      const result = await ManageAgentsFacade.execute({ action: 'remove', name: 'Bot1' });
      expect(result.success).toBe(false);
      // Restore
      Object.defineProperty(profileCacheManager, 'currentUserAlias', {
        get: () => 'test-user',
        configurable: true,
      });
    });
  });

  describe('action=remove', () => {
    it('finds and deletes chat config', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'remove', name: 'Bot1' });

      expect(result.success).toBe(true);
      expect(profileCacheManager.deleteChatConfig).toHaveBeenCalledWith('test-user', 'chat-1');
    });

    it('returns error for non-existent agent', async () => {
      const result = await ManageAgentsFacade.execute({ action: 'remove', name: 'Ghost' });
      expect(result.success).toBe(false);
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

  describe('action=status', () => {
    it('maps name to agent_name', async () => {
      await ManageAgentsFacade.execute({ action: 'status', name: 'Bot1' });
      expect(GetAgentStatusTool.execute).toHaveBeenCalledWith({ agent_name: 'Bot1' });
    });
  });
});
