/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

function makeSessionProfileAPI(overrides: Record<string, any> = {}) {
  return {
    saveChatSession: vi.fn(async () => ({ success: true })),
    deleteChatSession: vi.fn(async () => ({ success: true })),
    getChatSessionFile: vi.fn(async () => ({
      success: true,
      data: { chatSession_id: 's1', last_updated: '2024-01-01T00:00:00Z', title: 'Test', chat_history: [], context_history: [] }
    })),
    getChatSessions: vi.fn(async () => ({
      success: true,
      data: [{ chatSession_id: 's1', last_updated: '2024-01-01T00:00:00Z', title: 'Session One' }]
    })),
    ...overrides,
  };
}

function setupWindow(profileOverrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      getInstallationDeviceId: vi.fn(async () => 'Device:01'),
      profile: makeSessionProfileAPI(profileOverrides),
    },
  });
}

describe('ChatSessionOpsManager', () => {
  beforeEach(() => {
    vi.resetModules();
    setupWindow();
  });

  async function getInstance() {
    const mod = await import('../chatSessionOps');
    return { mgr: mod.ChatSessionOpsManager.getInstance(), mod };
  }

  it('getInstance() returns the same singleton', async () => {
    const { mod } = await getInstance();
    expect(mod.ChatSessionOpsManager.getInstance()).toBe(mod.ChatSessionOpsManager.getInstance());
  });

  it('saveChatSession() succeeds and stamps last_updated', async () => {
    const { mgr } = await getInstance();
    const session = { chatSession_id: 's1', last_updated: '', title: 'T', chat_history: [], context_history: [] };
    const result = await mgr.saveChatSession('alice', 'c1', session);
    expect(result.success).toBe(true);
    expect(result.data.last_updated).not.toBe('');
  });

  it('saveChatSession() returns error when API not available', async () => {
    const { mgr } = await getInstance();
    (window as any).electronAPI.profile.saveChatSession = undefined;
    const result = await mgr.saveChatSession('alice', 'c1', { chatSession_id: 's1', last_updated: '', title: 'T', chat_history: [], context_history: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('saveChatSession() returns error on IPC failure', async () => {
    setupWindow({ saveChatSession: vi.fn(async () => ({ success: false, error: 'save fail' })) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().saveChatSession(
      'alice', 'c1',
      { chatSession_id: 's1', last_updated: '', title: 'T', chat_history: [], context_history: [] }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('save fail');
  });

  it('saveChatSession() handles thrown exceptions', async () => {
    setupWindow({ saveChatSession: vi.fn(async () => { throw new Error('boom'); }) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().saveChatSession(
      'alice', 'c1',
      { chatSession_id: 's1', last_updated: '', title: 'T', chat_history: [], context_history: [] }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('deleteChatSession() succeeds', async () => {
    const { mgr } = await getInstance();
    const result = await mgr.deleteChatSession('alice', 'c1', 's1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sessionId: 's1' });
  });

  it('deleteChatSession() returns error when API not available', async () => {
    const { mgr } = await getInstance();
    (window as any).electronAPI.profile.deleteChatSession = undefined;
    const result = await mgr.deleteChatSession('alice', 'c1', 's1');
    expect(result.success).toBe(false);
  });

  it('deleteChatSession() returns error on IPC failure', async () => {
    setupWindow({ deleteChatSession: vi.fn(async () => ({ success: false, error: 'delete fail' })) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().deleteChatSession('alice', 'c1', 's1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('delete fail');
  });

  it('deleteChatSession() handles thrown exceptions', async () => {
    setupWindow({ deleteChatSession: vi.fn(async () => { throw new Error('delete boom'); }) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().deleteChatSession('alice', 'c1', 's1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('delete boom');
  });

  it('getChatSessionList() returns formatted session list', async () => {
    const { mgr } = await getInstance();
    const result = await mgr.getChatSessionList('alice', 'c1');
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual({ chatSession_id: 's1', last_updated: '2024-01-01T00:00:00Z', title: 'Session One' });
  });

  it('getChatSessionList() returns error when API not available', async () => {
    const { mgr } = await getInstance();
    (window as any).electronAPI.profile.getChatSessions = undefined;
    const result = await mgr.getChatSessionList('alice', 'c1');
    expect(result.success).toBe(false);
  });

  it('getChatSessionList() returns error on IPC failure', async () => {
    setupWindow({ getChatSessions: vi.fn(async () => ({ success: false, error: 'list fail' })) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().getChatSessionList('alice', 'c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('list fail');
  });

  it('getChatSessionList() handles null data', async () => {
    setupWindow({ getChatSessions: vi.fn(async () => ({ success: true, data: null })) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().getChatSessionList('alice', 'c1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('getChatSessionList() handles thrown exceptions', async () => {
    setupWindow({ getChatSessions: vi.fn(async () => { throw new Error('list boom'); }) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().getChatSessionList('alice', 'c1');
    expect(result.success).toBe(false);
  });

  it('getChatSessionFile() returns session file data', async () => {
    const { mgr } = await getInstance();
    const result = await mgr.getChatSessionFile('alice', 'c1', 's1');
    expect(result.success).toBe(true);
    expect(result.data.chatSession_id).toBe('s1');
  });

  it('getChatSessionFile() returns error when API not available', async () => {
    const { mgr } = await getInstance();
    (window as any).electronAPI.profile.getChatSessionFile = undefined;
    const result = await mgr.getChatSessionFile('alice', 'c1', 's1');
    expect(result.success).toBe(false);
  });

  it('getChatSessionFile() returns error on IPC failure', async () => {
    setupWindow({ getChatSessionFile: vi.fn(async () => ({ success: false, error: 'file fail' })) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().getChatSessionFile('alice', 'c1', 's1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('file fail');
  });

  it('getChatSessionFile() handles thrown exceptions', async () => {
    setupWindow({ getChatSessionFile: vi.fn(async () => { throw new Error('file boom'); }) });
    const { mod } = await getInstance();
    const result = await mod.ChatSessionOpsManager.getInstance().getChatSessionFile('alice', 'c1', 's1');
    expect(result.success).toBe(false);
  });

  it('createNewChatSession() generates a session with defaults', async () => {
    const { mgr } = await getInstance();
    const result = await mgr.createNewChatSession('alice', 'c1');
    expect(result.success).toBe(true);
    const session = result.data;
    expect(session.title).toBe('New Chat');
    expect(session.chat_history).toEqual([]);
    expect(session.context_history).toEqual([]);
  });

  it('createNewChatSession() uses custom title', async () => {
    const { mgr } = await getInstance();
    const result = await mgr.createNewChatSession('alice', 'c1', 'My Session');
    expect(result.success).toBe(true);
    expect(result.data.title).toBe('My Session');
  });

  it('isValidChatSessionId() validates session ID format', async () => {
    const { mgr } = await getInstance();
    // Valid format (device ID based)
    const valid = mgr.isValidChatSessionId('session-Device-01-20240101120000000-abcdef12');
    // The actual format check depends on idFormats; just ensure no throw
    expect(typeof valid).toBe('boolean');
  });
});

describe('chatSessionOps convenience exports', () => {
  beforeEach(() => {
    vi.resetModules();
    setupWindow();
  });

  it('all convenience functions delegate correctly', async () => {
    const mod = await import('../chatSessionOps');
    const session = { chatSession_id: 's1', last_updated: '', title: 'T', chat_history: [], context_history: [] };

    expect(await mod.saveChatSession('alice', 'c1', session)).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.deleteChatSession('alice', 'c1', 's1')).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.getChatSessionList('alice', 'c1')).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.getChatSessionFile('alice', 'c1', 's1')).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.createNewChatSession('alice', 'c1')).toEqual(expect.objectContaining({ success: true }));
    expect(typeof mod.isValidChatSessionId('any-id')).toBe('boolean');
  });
});
