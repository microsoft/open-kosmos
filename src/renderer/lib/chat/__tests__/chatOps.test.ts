/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

function makeProfileAPI(overrides: Record<string, any> = {}) {
  return {
    addChatConfig: vi.fn(async () => ({ success: true })),
    updateChatConfig: vi.fn(async () => ({ success: true })),
    deleteChatConfig: vi.fn(async () => ({ success: true })),
    getChatConfig: vi.fn(async () => ({ success: true, data: { chat_id: 'c1' } })),
    getAllChatConfigs: vi.fn(async () => ({ success: true, data: [] })),
    updateChatAgent: vi.fn(async () => ({ success: true })),
    duplicateChatConfig: vi.fn(async () => ({ success: true, newChatId: 'c-new', knowledgeCopyFailed: false, scheduleCopyFailed: false })),
    ...overrides,
  };
}

function setupWindow(profileOverrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      getInstallationDeviceId: vi.fn(async () => 'Device:01'),
      profile: makeProfileAPI(profileOverrides),
    },
  });
}

describe('ChatOpsManager', () => {
  beforeEach(() => {
    vi.resetModules();
    setupWindow();
  });

  async function getManager() {
    const mod = await import('../chatOps');
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    return { mgr, mod };
  }

  it('getInstance() returns the same singleton', async () => {
    const { mod } = await getManager();
    expect(mod.ChatOpsManager.getInstance()).toBe(mod.ChatOpsManager.getInstance());
  });

  it('initialize() sets user alias and cleanup() clears it', async () => {
    const { mgr } = await getManager();
    mgr.cleanup();
    // After cleanup, any operation should fail with unauthenticated error
    const result = await mgr.addChatConfig({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No user authenticated');
  });

  it('addChatConfig() succeeds with minimal config', async () => {
    const { mgr } = await getManager();
    const result = await mgr.addChatConfig({ chat_type: 'single_agent' });
    expect(result.success).toBe(true);
  });

  it('addChatConfig() adds DEFAULT_CHAT_AGENT when no agent provided for single_agent', async () => {
    const { mgr } = await getManager();
    const result = await mgr.addChatConfig({ chat_type: 'single_agent' });
    expect(result.success).toBe(true);
  });

  it('addChatConfig() uses provided chat_id', async () => {
    const profileAPI = makeProfileAPI();
    setupWindow({ ...profileAPI });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.addChatConfig({ chat_id: 'fixed-id', chat_type: 'multi_agent', agents: [] });
    expect(result.success).toBe(true);
    const call = (window as any).electronAPI.profile.addChatConfig.mock.calls[0][0];
    expect(call.chat_id).toBe('fixed-id');
  });

  it('addChatConfig() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.addChatConfig = undefined;
    const result = await mgr.addChatConfig({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('addChatConfig() returns error on IPC failure', async () => {
    setupWindow({ addChatConfig: vi.fn(async () => ({ success: false, error: 'IPC error' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.addChatConfig({ chat_type: 'single_agent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('IPC error');
  });

  it('addChatConfig() handles thrown exceptions', async () => {
    setupWindow({ addChatConfig: vi.fn(async () => { throw new Error('Network timeout'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.addChatConfig({ chat_type: 'single_agent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  it('updateChatConfig() succeeds', async () => {
    const { mgr } = await getManager();
    const result = await mgr.updateChatConfig('chat-1', { chat_type: 'single_agent' });
    expect(result.success).toBe(true);
  });

  it('updateChatConfig() fails when chatId is empty', async () => {
    const { mgr } = await getManager();
    const result = await mgr.updateChatConfig('  ', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Chat ID is required');
  });

  it('updateChatConfig() returns error on IPC failure', async () => {
    setupWindow({ updateChatConfig: vi.fn(async () => ({ success: false, error: 'update fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.updateChatConfig('c1', {});
    expect(result.success).toBe(false);
  });

  it('deleteChatConfig() succeeds', async () => {
    const { mgr } = await getManager();
    const result = await mgr.deleteChatConfig('chat-1');
    expect(result.success).toBe(true);
  });

  it('deleteChatConfig() fails when chatId is empty', async () => {
    const { mgr } = await getManager();
    const result = await mgr.deleteChatConfig('');
    expect(result.success).toBe(false);
  });

  it('deleteChatConfig() returns error on IPC failure', async () => {
    setupWindow({ deleteChatConfig: vi.fn(async () => ({ success: false, error: 'delete fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.deleteChatConfig('c1');
    expect(result.success).toBe(false);
  });

  it('getChatConfig() returns data', async () => {
    const { mgr } = await getManager();
    const result = await mgr.getChatConfig('c1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ chat_id: 'c1' });
  });

  it('getChatConfig() fails when chatId is empty', async () => {
    const { mgr } = await getManager();
    const result = await mgr.getChatConfig('');
    expect(result.success).toBe(false);
  });

  it('getChatConfig() returns error on IPC failure', async () => {
    setupWindow({ getChatConfig: vi.fn(async () => ({ success: false, error: 'get fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatConfig('c1');
    expect(result.success).toBe(false);
  });

  it('getAllChatConfigs() returns data', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => ({ success: true, data: [{ chat_id: 'c1' }] })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getAllChatConfigs();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('getAllChatConfigs() returns empty array as fallback', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => ({ success: true, data: null })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getAllChatConfigs();
    expect(result.data).toEqual([]);
  });

  it('getAllChatConfigs() returns error on IPC failure', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => ({ success: false, error: 'all fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getAllChatConfigs();
    expect(result.success).toBe(false);
  });

  it('updateChatAgent() succeeds', async () => {
    const { mgr } = await getManager();
    const result = await mgr.updateChatAgent('c1', { name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('updateChatAgent() fails with empty chatId', async () => {
    const { mgr } = await getManager();
    const result = await mgr.updateChatAgent('', {});
    expect(result.success).toBe(false);
  });

  it('updateChatAgent() returns error on IPC failure', async () => {
    setupWindow({ updateChatAgent: vi.fn(async () => ({ success: false, error: 'agent fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.updateChatAgent('c1', {});
    expect(result.success).toBe(false);
  });

  it('getChatInfoList() formats single_agent display name', async () => {
    setupWindow({
      getAllChatConfigs: vi.fn(async () => ({
        success: true,
        data: [{ chat_id: 'c1', chat_type: 'single_agent', agent: { emoji: '🤖', name: 'Bot', workspace: '' } }]
      }))
    });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.success).toBe(true);
    expect(result.data[0].displayName).toBe('🤖 Bot');
    expect(result.data[0].agentCount).toBe(1);
  });

  it('getChatInfoList() formats multi_agent display name', async () => {
    setupWindow({
      getAllChatConfigs: vi.fn(async () => ({
        success: true,
        data: [{
          chat_id: 'c1',
          chat_type: 'multi_agent',
          agents: [{ name: 'Alpha', emoji: '', workspace: '' }, { name: 'Beta', emoji: '', workspace: '' }]
        }]
      }))
    });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.data[0].displayName).toBe('Multi-Agent: Alpha, Beta');
    expect(result.data[0].agentCount).toBe(2);
  });

  it('getChatInfoList() uses chat_id as display name when no agent info', async () => {
    setupWindow({
      getAllChatConfigs: vi.fn(async () => ({
        success: true,
        data: [{ chat_id: 'c1', chat_type: 'single_agent' }]
      }))
    });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.data[0].displayName).toBe('c1');
  });

  it('getChatInfoList() propagates getAllChatConfigs failure', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => ({ success: false, error: 'fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.success).toBe(false);
  });

  it('getChatInfoList() handles thrown exceptions', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => { throw new Error('map crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.success).toBe(false);
    expect(result.error).toContain('map crash');
  });

  it('updateChatAgent() handles thrown exceptions', async () => {
    setupWindow({ updateChatAgent: vi.fn(async () => { throw new Error('agent crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.updateChatAgent('c1', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent crash');
  });

  it('duplicateChatConfig() handles thrown exceptions', async () => {
    setupWindow({ duplicateChatConfig: vi.fn(async () => { throw new Error('dup crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.duplicateChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('dup crash');
  });

  it('addChatConfig() spreads agent.workspace when agent is provided', async () => {
    setupWindow();
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.addChatConfig({
      chat_type: 'single_agent',
      agent: { name: 'Bot', emoji: '🤖', workspace: '/custom' } as any
    });
    expect(result.success).toBe(true);
    const call = (window as any).electronAPI.profile.addChatConfig.mock.calls[0][0];
    expect(call.agent.workspace).toBe('/custom');
  });

  it('createDefaultChat() creates a single_agent chat', async () => {
    const { mgr } = await getManager();
    const result = await mgr.createDefaultChat();
    expect(result.success).toBe(true);
  });

  it('createDefaultChat() merges customAgent', async () => {
    const { mgr } = await getManager();
    const result = await mgr.createDefaultChat({ name: 'CustomBot' });
    expect(result.success).toBe(true);
    const call = (window as any).electronAPI.profile.addChatConfig.mock.calls[0][0];
    expect(call.agent.name).toBe('CustomBot');
  });

  it('duplicateChatConfig() succeeds', async () => {
    const { mgr } = await getManager();
    const result = await mgr.duplicateChatConfig('c1', 'New Agent');
    expect(result.success).toBe(true);
    expect(result.data.chat_id).toBe('c-new');
  });

  it('duplicateChatConfig() uses default name when not provided', async () => {
    const { mgr } = await getManager();
    await mgr.duplicateChatConfig('c1');
    const call = (window as any).electronAPI.profile.duplicateChatConfig.mock.calls[0];
    expect(call[1]).toBe('Agent Copy');
  });

  it('duplicateChatConfig() returns error on IPC failure', async () => {
    setupWindow({ duplicateChatConfig: vi.fn(async () => ({ success: false, error: 'dup fail' })) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.duplicateChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('dup fail');
  });

  it('duplicateChatConfig() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.duplicateChatConfig = undefined;
    const result = await mgr.duplicateChatConfig('c1');
    expect(result.success).toBe(false);
  });

  it('getChatInfoList() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.getAllChatConfigs = undefined;
    const result = await mgr.getChatInfoList();
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('updateChatAgent() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.updateChatAgent = undefined;
    const result = await mgr.updateChatAgent('c1', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('duplicateChatConfig() returns error when validateAPI fails', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.addChatConfig = undefined;
    const result = await mgr.duplicateChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('deleteChatConfig() catch block when API throws', async () => {
    setupWindow({ deleteChatConfig: vi.fn(async () => { throw new Error('delete crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.deleteChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('delete crash');
  });

  it('getChatConfig() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.getChatConfig = undefined;
    const result = await mgr.getChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('getChatConfig() catch block when API throws', async () => {
    setupWindow({ getChatConfig: vi.fn(async () => { throw new Error('get crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('get crash');
  });

  it('getChatInfoList() catch block when getAllChatConfigs throws', async () => {
    setupWindow({ getAllChatConfigs: vi.fn(async () => { throw new Error('info crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.getChatInfoList();
    expect(result.success).toBe(false);
    expect(result.error).toContain('info crash');
  });

  it('updateChatConfig() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.updateChatConfig = undefined;
    const result = await mgr.updateChatConfig('c1', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('updateChatConfig() catch block when API throws', async () => {
    setupWindow({ updateChatConfig: vi.fn(async () => { throw new Error('upd crash'); }) });
    const { mod } = await getManager();
    const mgr = mod.ChatOpsManager.getInstance();
    mgr.initialize('alice');
    const result = await mgr.updateChatConfig('c1', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('upd crash');
  });

  it('deleteChatConfig() returns error when API not available', async () => {
    const { mgr } = await getManager();
    (window as any).electronAPI.profile.deleteChatConfig = undefined;
    const result = await mgr.deleteChatConfig('c1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });
});

describe('chatOps convenience exports', () => {
  beforeEach(() => {
    vi.resetModules();
    setupWindow();
  });

  it('addChat, updateChat, deleteChat, getChat, getAllChats, updateAgent, updateChatAgent, getChatList, createDefaultChat, duplicateChat all delegate correctly', async () => {
    const mod = await import('../chatOps');
    mod.chatOps.initialize('alice');

    expect(await mod.addChat({})).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.updateChat('c1', {})).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.deleteChat('c1')).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.getChat('c1')).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.getAllChats()).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.updateAgent('c1', {})).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.updateChatAgent('c1', {})).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.getChatList()).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.createDefaultChat()).toEqual(expect.objectContaining({ success: true }));
    expect(await mod.duplicateChat('c1', 'Copy')).toEqual(expect.objectContaining({ success: true }));
  });
});
