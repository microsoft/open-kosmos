describe('AgentChatSessionCacheManager.replaceFilePathInMessages', () => {
  beforeEach(() => {
    vi.resetModules();
    (global as any).window = {
      electronAPI: {
        agentChat: {},
      },
    };
  });

  afterEach(async () => {
    const module = await import('../agentChatSessionCacheManager');
    module.agentChatSessionCacheManager.cleanup();
    vi.clearAllMocks();
  });

  it('updates cached message paths and emits a direct message update', async () => {
    const oldPath = '/tmp/chat/output/report.md';
    const newPath = '/tmp/knowledge/report.md';

    const module = await import('../agentChatSessionCacheManager');
    const manager = module.agentChatSessionCacheManager;

    manager.createChatSessionCache('session-1', 'chat-1', {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: [
            { type: 'text', text: `Saved file to ${oldPath}` },
            {
              type: 'file',
              file: {
                fileName: 'report.md',
                filePath: oldPath,
                mimeType: 'text/markdown',
              },
              metadata: {
                fileSize: 128,
              },
            },
          ],
          tool_calls: [
            {
              id: 'tool-1',
              type: 'function',
              function: {
                name: 'present_deliverables',
                arguments: JSON.stringify({
                  filePaths: [oldPath],
                  description: 'Final deliverables',
                }),
              },
            },
          ],
        } as any,
      ],
      chatStatus: 'idle',
    });

    manager.setCurrentChatSessionId('chat-1', 'session-1');

    const directUpdateCallback = vi.fn();
    const unsubscribe = manager.registerDirectMessageUpdateCallback('session-1', directUpdateCallback);

    const replacedCount = manager.replaceFilePathInMessages(oldPath, newPath);
    const cache = manager.getChatSessionCache('session-1');
    const updatedMessage = cache?.messages[0] as any;

    expect(replacedCount).toBe(3);
    expect(updatedMessage.content[0].text).toContain(newPath);
    expect(updatedMessage.content[1].file.filePath).toBe(newPath);
    expect(updatedMessage.tool_calls[0].function.arguments).toContain(newPath);
    expect(directUpdateCallback).toHaveBeenCalledTimes(1);
    expect(directUpdateCallback.mock.calls[0][0].tool_calls[0].function.arguments).toContain(newPath);

    unsubscribe();
  });
});