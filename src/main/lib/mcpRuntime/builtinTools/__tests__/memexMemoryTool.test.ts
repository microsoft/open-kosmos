import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── electron app mock ──
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/userData') },
}));

// ── MemexService mock: each method echoes so we can assert routing ──
const mockRecall = vi.fn().mockResolvedValue('recall-output');
const mockSearch = vi.fn().mockResolvedValue('search-output');
const mockRetro = vi.fn().mockResolvedValue('Saved card: my-note');
const mockCapture = vi.fn().mockResolvedValue({
  status: 'created',
  changed: true,
  output: 'Captured memory card: my-note',
  metadata: { writeSucceeded: true, slug: 'my-note' },
});
const mockRead = vi.fn().mockResolvedValue('# card body');
const mockWrite = vi.fn().mockResolvedValue('Saved card: raw');
const mockLinks = vi.fn().mockResolvedValue('links-output');
const mockOrganize = vi.fn().mockResolvedValue('organize-output');
const mockArchive = vi.fn().mockResolvedValue('Archived card: gone');
vi.mock('../../../memex/MemexService', () => ({
  memexService: {
    recall: (...a: any[]) => (mockRecall as any)(...a),
    search: (...a: any[]) => (mockSearch as any)(...a),
    retro: (...a: any[]) => (mockRetro as any)(...a),
    capture: (...a: any[]) => (mockCapture as any)(...a),
    read: (...a: any[]) => (mockRead as any)(...a),
    write: (...a: any[]) => (mockWrite as any)(...a),
    links: (...a: any[]) => (mockLinks as any)(...a),
    organize: (...a: any[]) => (mockOrganize as any)(...a),
    archive: (...a: any[]) => (mockArchive as any)(...a),
  },
}));

// ── memexHome mock ──
const FAKE_HOME = { root: '/r', cardsDir: '/r/cards', archiveDir: '/r/archive' };
const FAKE_PROFILE_HOME = { root: '/p', cardsDir: '/p/cards', archiveDir: '/p/archive' };
const mockBuildAgentMemexHome = vi.fn(() => FAKE_HOME);
const mockBuildProfileMemexHome = vi.fn(() => FAKE_PROFILE_HOME);
const mockEnsureHome = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../memex/memexHome', () => ({
  buildAgentMemexHome: (...a: any[]) => (mockBuildAgentMemexHome as any)(...a),
  buildProfileMemexHome: (...a: any[]) => (mockBuildProfileMemexHome as any)(...a),
  ensureHome: (...a: any[]) => (mockEnsureHome as any)(...a),
}));

// ── memexEvents mock: assert change notifications ──
const mockEmitCardsChanged = vi.fn();
vi.mock('../../../memex/memexEvents', () => ({
  emitCardsChanged: (...a: any[]) => (mockEmitCardsChanged as any)(...a),
}));

import { MemexMemoryTool, MEMEX_OPERATIONS } from '../memexMemoryTool';

const ctx = { userAlias: 'alice', agentId: 'agent-1', chatId: 'chat-1', agentName: 'Helper' };
const captureContext = {
  userAlias: 'alice',
  chatId: 'chat-1',
  chatSessionId: 'chatSession_20260707120000_device_random',
  sourceAgentId: 'agent-1',
  sourceAgentName: 'Helper',
};

describe('MemexMemoryTool.getDefinition', () => {
  it('exposes the memex_memory tool with all operations enumerated', () => {
    const def = MemexMemoryTool.getDefinition();
    expect(def.name).toBe('memex_memory');
    const enumVals = (def.inputSchema as any).properties.operation.enum;
    expect(enumVals).toEqual([...MEMEX_OPERATIONS]);
    expect(enumVals).toContain('capture');
    expect(enumVals).not.toContain('retro');
    expect(enumVals).not.toContain('write');
    expect((def.inputSchema as any).properties.scope.enum).toEqual(['current-agent', 'profile-memory']);
    expect((def.inputSchema as any).required).toEqual(['operation', 'description']);
  });
});

describe('MemexMemoryTool.execute validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAgentMemexHome.mockReturnValue(FAKE_HOME);
    mockBuildProfileMemexHome.mockReturnValue(FAKE_PROFILE_HOME);
    mockEnsureHome.mockResolvedValue(undefined);
  });

  it('rejects an unknown operation', async () => {
    const res = await MemexMemoryTool.execute({ operation: 'frobnicate', description: 'x' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid operation');
    expect(res.hint).toContain('recall');
  });

  it('rejects a missing operation', async () => {
    const res = await MemexMemoryTool.execute({ description: 'x' } as any, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid operation');
  });

  it('rejects an invalid scope before resolving an agent', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'recall', description: 'x', scope: 'invalid-scope' },
      { userAlias: 'alice', chatId: 'chat-1' } as any,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid scope');
    expect(res.hint).toContain('profile-memory');
  });

  it('rejects when there is no profile execution context', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'recall', description: 'x' },
      { userAlias: '', agentId: '', chatId: 'chat-1' } as any,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('cannot resolve');
  });

  it('rejects capture on the compatibility string execution path', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'capture', description: 'd', mode: 'remember' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('detailed internal execution path');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('allows profile-memory without an agentId', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'recall', description: 'x', scope: 'profile-memory' },
      { userAlias: 'alice', chatId: 'chat-1' } as any,
    );
    expect(res.success).toBe(true);
    expect(mockBuildProfileMemexHome).toHaveBeenCalledWith('/tmp/userData', 'alice');
    expect(mockRecall).toHaveBeenCalledWith(FAKE_PROFILE_HOME, undefined, undefined, undefined);
  });

  it('surfaces a typed error when resolving memory fails', async () => {
    mockBuildAgentMemexHome.mockImplementationOnce(() => { throw new Error('bad agentId'); });
    const res = await MemexMemoryTool.execute({ operation: 'recall', description: 'x' }, ctx);
    expect(res).toMatchObject({ success: false, operation: 'recall' });
    expect(res.error).toContain('Failed to open memory: bad agentId');
  });

  it('does not create the memory home for read-only operations', async () => {
    const res = await MemexMemoryTool.execute({ operation: 'recall', description: 'x' }, ctx);
    expect(res.success).toBe(true);
    expect(mockBuildAgentMemexHome).toHaveBeenCalledWith('/tmp/userData', 'alice', 'agent-1');
    expect(mockEnsureHome).not.toHaveBeenCalled();
  });
});

describe('MemexMemoryTool.execute routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAgentMemexHome.mockReturnValue(FAKE_HOME);
    mockBuildProfileMemexHome.mockReturnValue(FAKE_PROFILE_HOME);
    mockEnsureHome.mockResolvedValue(undefined);
  });

  it('recall passes query, limit, and filter', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'recall', description: 'd', query: 'cats', limit: 5, category: 'pets', tag: 't', since: '2024-01-01', before: '2025-01-01' },
      ctx,
    );
    expect(res).toEqual({ success: true, operation: 'recall', output: 'recall-output' });
    expect(mockRecall).toHaveBeenCalledWith(FAKE_HOME, 'cats', 5, {
      category: 'pets', tag: 't', since: '2024-01-01', before: '2025-01-01',
    });
  });

  it('recall normalizes a non-positive limit to undefined', async () => {
    await MemexMemoryTool.execute({ operation: 'recall', description: 'd', limit: 0 }, ctx);
    expect(mockRecall).toHaveBeenCalledWith(FAKE_HOME, undefined, undefined, undefined);
  });

  it('search requires a query', async () => {
    const res = await MemexMemoryTool.execute({ operation: 'search', description: 'd' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('requires "query"');
  });

  it('search forwards a valid query', async () => {
    await MemexMemoryTool.execute({ operation: 'search', description: 'd', query: 'dogs' }, ctx);
    expect(mockSearch).toHaveBeenCalledWith(FAKE_HOME, 'dogs', undefined, undefined);
  });

  it('capture uses the detailed execution path and returns write metadata', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'capture', description: 'd', mode: 'remember', title: 'My Note', body: 'hi', category: 'c', source_type: 'chat-session', tags: ['a'] },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('capture uses detailed context and returns metadata', async () => {
    const res = await MemexMemoryTool.executeDetailed(
      { operation: 'capture', description: 'd', mode: 'remember', title: 'My Note', body: 'hi', category: 'c', source_type: 'chat-session', tags: ['a'] },
      { ...ctx, captureContext },
    );
    expect(res).toMatchObject({
      success: true,
      operation: 'capture',
      output: 'Captured memory card: my-note',
      changed: true,
      metadata: { writeSucceeded: true, slug: 'my-note' },
    });
    expect(mockCapture).toHaveBeenCalledWith(FAKE_HOME, {
      mode: 'remember',
      scope: 'current-agent',
      slug: undefined,
      title: 'My Note',
      body: 'hi',
      category: 'c',
      tags: ['a'],
      source_type: 'chat-session',
      source: undefined,
      source_anchor: undefined,
      profile_intent_quote: undefined,
      related_slugs: undefined,
    }, captureContext);
  });

  it('read requires a slug and forwards it', async () => {
    await MemexMemoryTool.execute({ operation: 'read', description: 'd', slug: 'c1' }, ctx);
    expect(mockRead).toHaveBeenCalledWith(FAKE_HOME, 'c1');
  });

  it('links is allowed without a slug (aggregate stats)', async () => {
    await MemexMemoryTool.execute({ operation: 'links', description: 'd' }, ctx);
    expect(mockLinks).toHaveBeenCalledWith(FAKE_HOME, undefined);
  });

  it('organize forwards to the service', async () => {
    const res = await MemexMemoryTool.execute({ operation: 'organize', description: 'd' }, ctx);
    expect(res.output).toBe('organize-output');
    expect(mockOrganize).toHaveBeenCalledWith(FAKE_HOME);
  });

  it('archive requires a slug', async () => {
    const res = await MemexMemoryTool.execute({ operation: 'archive', description: 'd' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('requires "slug"');
  });

  it('rejects sub-agent archive mutations', async () => {
    const res = await MemexMemoryTool.execute(
      { operation: 'archive', description: 'd', slug: 's' },
      { ...ctx, isSubAgent: true },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('Sub-agents can only read');
    expect(mockArchive).not.toHaveBeenCalled();
    expect(mockEmitCardsChanged).not.toHaveBeenCalled();
  });
});

describe('MemexMemoryTool change notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAgentMemexHome.mockReturnValue(FAKE_HOME);
    mockBuildProfileMemexHome.mockReturnValue(FAKE_PROFILE_HOME);
    mockEnsureHome.mockResolvedValue(undefined);
  });

  it('emits cardsChanged after changed capture', async () => {
    await MemexMemoryTool.executeDetailed(
      { operation: 'capture', description: 'd', mode: 'remember', title: 'T', body: 'b', category: 'c', source_type: 'chat-session' },
      { ...ctx, captureContext },
    );
    expect(mockEmitCardsChanged).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'current-agent', agentId: 'agent-1', chatId: 'chat-1' });
  });

  it('does not emit cardsChanged after unchanged capture', async () => {
    mockCapture.mockResolvedValueOnce({
      status: 'already-captured',
      changed: false,
      output: 'Already captured card: s',
      metadata: { writeSucceeded: true, slug: 's' },
    });
    await MemexMemoryTool.executeDetailed(
      { operation: 'capture', description: 'd', mode: 'remember', title: 'T', body: 'b', category: 'c', source_type: 'chat-session' },
      { ...ctx, captureContext },
    );
    expect(mockEmitCardsChanged).not.toHaveBeenCalled();
  });

  it('emits cardsChanged after archive', async () => {
    await MemexMemoryTool.execute({ operation: 'archive', description: 'd', slug: 's' }, ctx);
    expect(mockEmitCardsChanged).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'current-agent', agentId: 'agent-1', chatId: 'chat-1' });
  });

  it('emits profile-memory cardsChanged after a profile-memory capture', async () => {
    await MemexMemoryTool.executeDetailed(
      { operation: 'capture', description: 'd', scope: 'profile-memory', mode: 'remember', title: 'T', body: 'b', category: 'preference', source_type: 'chat-session' },
      { userAlias: 'alice', chatId: 'chat-1', captureContext } as any,
    );
    expect(mockEmitCardsChanged).toHaveBeenCalledWith({
      userAlias: 'alice',
      scope: 'profile-memory',
      agentId: undefined,
      chatId: 'chat-1',
    });
  });

  it('does NOT emit cardsChanged after a read-only recall', async () => {
    await MemexMemoryTool.execute({ operation: 'recall', description: 'd' }, ctx);
    expect(mockEmitCardsChanged).not.toHaveBeenCalled();
  });

  it('does NOT emit when a mutation throws', async () => {
    mockCapture.mockRejectedValueOnce(new Error('write failed'));
    const res = await MemexMemoryTool.executeDetailed(
      { operation: 'capture', description: 'd', mode: 'remember', title: 'T', body: 'b', category: 'c', source_type: 'chat-session' },
      { ...ctx, captureContext },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('write failed');
    expect(mockEmitCardsChanged).not.toHaveBeenCalled();
  });
});
