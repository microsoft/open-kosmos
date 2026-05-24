/**
 * @vitest-environment happy-dom
 */

describe('ChatOps ID format integration', () => {
  beforeEach(() => {
    vi.resetModules();

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getInstallationDeviceId: vi.fn().mockResolvedValue('Device:01'),
        profile: {
          addChatConfig: vi.fn().mockResolvedValue({ success: true }),
          updateChatConfig: vi.fn(),
          deleteChatConfig: vi.fn(),
          getChatConfig: vi.fn(),
          getAllChatConfigs: vi.fn(),
          updateChatAgent: vi.fn(),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  it('uses installation device id when generating a new chat id', async () => {
    const { ChatOpsManager } = await import('../chatOps');

    const manager = ChatOpsManager.getInstance();
    manager.initialize('alice');

    const result = await manager.addChatConfig({
      chat_type: 'single_agent',
      agent: {
        name: 'Agent',
        emoji: 'A',
        role: 'assistant',
        system_prompt: '',
        model: 'gpt-4o',
        mcp_servers: [],
        workspace: '',
      },
    });

    expect(result.success).toBe(true);
    expect(window.electronAPI.getInstallationDeviceId).toHaveBeenCalled();
    expect(window.electronAPI.profile.addChatConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: expect.stringMatching(/^chat_\d{14}_device-01_[a-z0-9]+$/i),
      }),
    );
  });

  it('falls back to unknown-device when installation device id is unavailable', async () => {
    (window.electronAPI.getInstallationDeviceId as Mock).mockResolvedValue('');

    const { ChatOpsManager } = await import('../chatOps');

    const manager = ChatOpsManager.getInstance();
    manager.initialize('alice');

    await manager.createDefaultChat();

    expect(window.electronAPI.profile.addChatConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: expect.stringMatching(/^chat_\d{14}_unknown-device_[a-z0-9]+$/i),
      }),
    );
  });
});