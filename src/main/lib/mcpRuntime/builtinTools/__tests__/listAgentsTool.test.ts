import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListAgentsTool } from '../listAgentsTool';
import { profileCacheManager } from '../../../userDataADO';

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    currentUserAlias: undefined as string | undefined,
    getCachedProfile: vi.fn(),
  },
}));

const pcm = profileCacheManager as unknown as {
  currentUserAlias: string | undefined;
  getCachedProfile: ReturnType<typeof vi.fn>;
};

describe('ListAgentsTool', () => {
  beforeEach(() => {
    pcm.currentUserAlias = 'alias';
    pcm.getCachedProfile.mockReset();
  });

  it('exposes an MCP-compatible definition', () => {
    const def = ListAgentsTool.getDefinition();
    expect(def.name).toBe('list_agents');
    expect(def.inputSchema.required).toEqual([]);
  });

  it('fails when no user session', async () => {
    pcm.currentUserAlias = undefined;
    const r = await ListAgentsTool.execute();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/sign in/i);
  });

  it('fails when profile missing', async () => {
    pcm.getCachedProfile.mockReturnValue(null);
    const r = await ListAgentsTool.execute();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/profile not found/i);
  });

  it('returns deduped agent names across chats', async () => {
    pcm.getCachedProfile.mockReturnValue({
      chats: [
        { agent: { name: 'Alpha' } },
        { agents: [{ name: 'Beta' }, { name: 'Gamma' }] },
        { agent: { name: 'Alpha' } },
        { agent: { name: '' } },
        {},
      ],
    });
    const r = await ListAgentsTool.execute();
    expect(r.success).toBe(true);
    expect(r.agents).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(r.count).toBe(3);
    expect(r.message).toContain('Found 3 agent(s): Alpha, Beta, Gamma');
  });

  it('reports empty when chats missing or no agents', async () => {
    pcm.getCachedProfile.mockReturnValue({ chats: undefined });
    const r = await ListAgentsTool.execute();
    expect(r.success).toBe(true);
    expect(r.agents).toEqual([]);
    expect(r.message).toMatch(/No agents configured/);
  });

  it('handles thrown errors', async () => {
    pcm.getCachedProfile.mockImplementation(() => {
      throw new Error('boom');
    });
    const r = await ListAgentsTool.execute();
    expect(r.success).toBe(false);
    expect(r.message).toContain('boom');
  });
});
