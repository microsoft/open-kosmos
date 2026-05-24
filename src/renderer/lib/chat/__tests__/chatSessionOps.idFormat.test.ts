/**
 * @vitest-environment happy-dom
 */

describe('ChatSessionOps ID format integration', () => {
  beforeEach(() => {
    vi.resetModules();

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getInstallationDeviceId: vi.fn().mockResolvedValue('Device:01'),
        profile: {
          saveChatSession: vi.fn().mockResolvedValue({ success: true }),
          deleteChatSession: vi.fn().mockResolvedValue({ success: true }),
          getChatSessionFile: vi.fn().mockResolvedValue({ success: true, data: {} }),
          getChatSessions: vi.fn().mockResolvedValue({ success: true, data: [] }),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  it('uses installation device id when generating a new chat session id', async () => {
    const { ChatSessionOpsManager } = await import('../chatSessionOps');

    const manager = ChatSessionOpsManager.getInstance();
    const result = await manager.createNewChatSession('alice', 'chat_20260330120000_device-01_abcd12345');

    expect(result.success).toBe(true);
    expect(window.electronAPI.getInstallationDeviceId).toHaveBeenCalled();
    expect(window.electronAPI.profile.saveChatSession).toHaveBeenCalledWith(
      'alice',
      'chat_20260330120000_device-01_abcd12345',
      expect.objectContaining({
        chatSession_id: expect.stringMatching(/^chatSession_\d{14}_device-01_[a-z0-9]+$/i),
      }),
    );
  });

  it('falls back to unknown-device when installation device id is unavailable', async () => {
    (window.electronAPI.getInstallationDeviceId as Mock).mockResolvedValue(undefined);

    const { ChatSessionOpsManager } = await import('../chatSessionOps');

    const manager = ChatSessionOpsManager.getInstance();
    await manager.createNewChatSession('alice', 'chat_20260330120000_device-01_abcd12345');

    expect(window.electronAPI.profile.saveChatSession).toHaveBeenCalledWith(
      'alice',
      'chat_20260330120000_device-01_abcd12345',
      expect.objectContaining({
        chatSession_id: expect.stringMatching(/^chatSession_\d{14}_unknown-device_[a-z0-9]+$/i),
      }),
    );
  });

  it('accepts both legacy and new chat session id formats for validation', async () => {
    const { ChatSessionOpsManager } = await import('../chatSessionOps');

    const manager = ChatSessionOpsManager.getInstance();
    expect(manager.isValidChatSessionId('chatSession_20260330150405')).toBe(true);
    expect(manager.isValidChatSessionId('chatSession_20260330150405_device-01_abc123xyz')).toBe(true);
    expect(manager.isValidChatSessionId('chatSession_invalid')).toBe(false);
  });
});