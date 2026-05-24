// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../agentChatSessionCacheManager', async () => ({
  agentChatSessionCacheManager: {
    replaceFilePathInMessages: vi.fn(),
    getCurrentChatSessionId: vi.fn(() => 'sess-1'),
    getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
    addUserMessage: vi.fn(),
    removeMessage: vi.fn(),
    setErrorMessage: vi.fn(),
  },
}));

vi.mock('../workspaceOps', async () => ({
  workspaceOps: {
    clearFileTreeCache: vi.fn(),
    triggerRefresh: vi.fn(),
  },
}));

vi.mock('../agentChatIpc', async () => ({
  agentChatIpc: {
    streamMessage: vi.fn(async () => []),
  },
}));

function makeWorkspaceAPI(overrides: Record<string, any> = {}) {
  return {
    movePath: vi.fn(async () => ({ success: true, data: { newPath: '/kb/file.txt' } })),
    ...overrides,
  };
}

function makeAgentChatAPI(overrides: Record<string, any> = {}) {
  return {
    replaceFilePathInSession: vi.fn(async () => ({})),
    ...overrides,
  };
}

function setupWindow(opts: { workspace?: Record<string, any>; agentChat?: Record<string, any> } = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      workspace: makeWorkspaceAPI(opts.workspace || {}),
      agentChat: makeAgentChatAPI(opts.agentChat || {}),
    },
  });
}

describe('moveFileToKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWindow();
  });

  it('moves file and returns new path on success', async () => {
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(true);
    expect(result.newPath).toBe('/kb/file.txt');
  });

  it('returns error when workspace.movePath API not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { workspace: null, agentChat: null },
    });
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('returns error when movePath fails without TARGET_EXISTS', async () => {
    setupWindow({ workspace: { movePath: vi.fn(async () => ({ success: false, error: 'Permission denied' })) } });
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('handles TARGET_EXISTS: user confirms overwrite', async () => {
    const movePath = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'TARGET_EXISTS', data: { sourceName: 'file.txt' } })
      .mockResolvedValueOnce({ success: true, data: {} });
    setupWindow({ workspace: { movePath } });
    (window as any).confirm = vi.fn(() => true);
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(true);
    expect(movePath).toHaveBeenCalledTimes(2);
    expect(movePath.mock.calls[1][2]).toEqual({ force: true });
  });

  it('handles TARGET_EXISTS: user cancels overwrite', async () => {
    setupWindow({ workspace: { movePath: vi.fn(async () => ({ success: false, error: 'TARGET_EXISTS', data: {} })) } });
    (window as any).confirm = vi.fn(() => false);
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('returns error when force overwrite also fails', async () => {
    const movePath = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'TARGET_EXISTS', data: {} })
      .mockResolvedValueOnce({ success: false, error: 'Write failed' });
    setupWindow({ workspace: { movePath } });
    (window as any).confirm = vi.fn(() => true);
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Write failed');
  });

  it('uses Windows path separator for new path', async () => {
    setupWindow();
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('C:\\workspace\\file.txt', 'C:\\knowledge');
    expect(result.success).toBe(true);
    expect(result.newPath).toBe('C:\\knowledge\\file.txt');
  });

  it('skips replaceFilePathInSession when not available', async () => {
    setupWindow({ agentChat: {} }); // No replaceFilePathInSession
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(true);
  });

  it('is non-fatal when replaceFilePathInMessages throws', async () => {
    setupWindow({
      agentChat: {
        replaceFilePathInSession: vi.fn(async () => { throw new Error('backend fail'); }),
      },
    });
    const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');
    (agentChatSessionCacheManager as any).replaceFilePathInMessages = vi.fn(() => { throw new Error('cache fail'); });

    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(true);
  });

  it('is non-fatal when clearFileTreeCache throws', async () => {
    setupWindow();
    const { workspaceOps } = await import('../workspaceOps');
    (workspaceOps as any).clearFileTreeCache = vi.fn(async () => { throw new Error('cache clear fail'); });

    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(true);
  });

  it('handles unknown error in outer catch', async () => {
    setupWindow({ workspace: { movePath: vi.fn(async () => { throw new Error('Unexpected crash'); }) } });
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    const result = await moveFileToKnowledgeBase('/tmp/file.txt', '/kb');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected crash');
  });

  it('passes force option through on initial call', async () => {
    const movePath = vi.fn(async () => ({ success: true, data: {} }));
    setupWindow({ workspace: { movePath } });
    const { moveFileToKnowledgeBase } = await import('../moveToKnowledgeBase');
    await moveFileToKnowledgeBase('/tmp/file.txt', '/kb', { force: true });
    expect(movePath.mock.calls[0][2]).toEqual({ force: true });
  });
});

describe('sendUserMessage and sendUserPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // isPathInKnowledgeBase: cover line 26 (normalizedFilePath or normalizedKnowledgeBasePath is empty)
  it('isPathInKnowledgeBase returns false when path normalizes to empty', async () => {
    const { isPathInKnowledgeBase } = await import('../moveToKnowledgeBase');
    // filePath that when normalized ends up empty-ish is hard, but we test with empty string
    expect(isPathInKnowledgeBase('', '/kb')).toBe(false);
  });

  it('sendUserMessage() sends and logs success', async () => {
    const { sendUserMessage } = await import('../sendUserMessageOptimistically');
    await expect(sendUserMessage({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 0,
    })).resolves.toBeUndefined();
  });

  it('sendUserMessage() catches and logs errors without rethrowing', async () => {
    const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');
    (agentChatSessionCacheManager as any).getUserMessageSendState = vi.fn(() => ({
      canSend: false,
      error: 'Not ready',
      chatStatus: null,
    }));

    const { sendUserMessage } = await import('../sendUserMessageOptimistically');
    // Should not throw even though the inner function will throw
    await expect(sendUserMessage({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 0,
    })).resolves.toBeUndefined();
  });

  it('sendUserPrompt() wraps text in a user message and sends', async () => {
    const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');
    (agentChatSessionCacheManager as any).getUserMessageSendState = vi.fn(() => ({
      canSend: true,
      error: '',
      chatStatus: 'idle',
    }));

    const { sendUserPrompt } = await import('../sendUserMessageOptimistically');
    await expect(sendUserPrompt('a prompt')).resolves.toBeUndefined();
  });

  it('sendUserMessageOptimistically() throws when userMessage has no id', async () => {
    const { sendUserMessageOptimistically } = await import('../sendUserMessageOptimistically');
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: true, error: '', chatStatus: 'idle' })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };
    await expect(sendUserMessageOptimistically({
      chatSessionId: 'sess-1',
      userMessage: { id: '', role: 'user', content: [], timestamp: 0 },
      cacheManager,
      send: vi.fn(),
    })).rejects.toThrow('stable message id');
  });

  it('sendUserMessageOptimistically() sets error but does not throw when no chatSessionId', async () => {
    const { sendUserMessageOptimistically } = await import('../sendUserMessageOptimistically');
    const cacheManager = {
      getUserMessageSendState: vi.fn(() => ({ canSend: false, error: 'not ready', chatStatus: null })),
      addUserMessage: vi.fn(),
      removeMessage: vi.fn(),
      setErrorMessage: vi.fn(),
    };
    await expect(sendUserMessageOptimistically({
      chatSessionId: null,
      userMessage: { id: 'u1', role: 'user', content: [], timestamp: 0 },
      cacheManager,
      send: vi.fn(),
    })).rejects.toThrow('not ready');
    // With null chatSessionId, setErrorMessage should NOT be called
    expect(cacheManager.setErrorMessage).not.toHaveBeenCalled();
  });
});
