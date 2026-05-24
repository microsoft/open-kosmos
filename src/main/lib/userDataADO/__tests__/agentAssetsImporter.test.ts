import * as fs from 'fs';
import { importChatSessionFromFile } from '../agentAssetsImporter';

const { createSessionMock, forceNotifyProfileDataManagerMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  forceNotifyProfileDataManagerMock: vi.fn(),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    createSession: createSessionMock,
  },
}));

vi.mock('../index', async () => ({
  profileCacheManager: {
    forceNotifyProfileDataManager: forceNotifyProfileDataManagerMock,
  },
}));

vi.mock('../pathUtils', async () => ({
  generateChatSessionId: vi.fn(() => 'chatSession_20260319010101_test-device_abc123xyz'),
  isValidChatSessionId: vi.fn(() => true),
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

describe('importChatSessionFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.promises.readFile as Mock).mockResolvedValue(
      JSON.stringify({
        chatSession_id: 'chatSession_20260318010101',
        last_updated: '2026-03-18T01:01:01.000Z',
        title: 'Imported session',
        chat_history: [],
        context_history: [],
      }),
    );
    createSessionMock.mockResolvedValue({
      alias: 'alice',
      chatId: 'chat_1',
      month: '202603',
      metadata: {
        chatSession_id: 'chatSession_20260319010101',
        title: 'Imported session',
        last_updated: '2026-03-19T01:01:01.000Z',
        readStatus: 'read',
        source: { type: 'local' },
      },
      file: {
        chatSession_id: 'chatSession_20260319010101',
        title: 'Imported session',
        last_updated: '2026-03-19T01:01:01.000Z',
        chat_history: [],
        context_history: [],
      },
      runtime: {
        loaded: true,
        dirtyMetadata: false,
        dirtyFile: false,
        revision: 1,
        persistedRevision: 1,
        lastAccessedAt: Date.now(),
        isFlushing: false,
      },
    });
    forceNotifyProfileDataManagerMock.mockResolvedValue(undefined);
  });

  it('creates imported session through chatSessionStore so UI listeners can update', async () => {
    const result = await importChatSessionFromFile('alice', 'chat_1', '/tmp/import.json');

    expect(result).toEqual({
      success: true,
      importedSessions: 1,
      importedSessionId: 'chatSession_20260319010101_test-device_abc123xyz',
      importedWorkspaceFiles: 0,
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith(
      'alice',
      'chat_1',
      expect.objectContaining({
        chatSession_id: 'chatSession_20260319010101_test-device_abc123xyz',
        title: 'Imported session',
        readStatus: 'read',
      }),
      expect.objectContaining({
        chatSession_id: 'chatSession_20260319010101_test-device_abc123xyz',
        title: 'Imported session',
      }),
      { autoSelect: false },
    );
    expect(forceNotifyProfileDataManagerMock).toHaveBeenCalledWith('alice');
  });
});