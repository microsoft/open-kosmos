import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async () => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    createSession: vi.fn(),
  },
}));

vi.mock('../index', async () => ({
  profileCacheManager: {
    forceNotifyProfileDataManager: vi.fn(async () => {}),
  },
}));

vi.mock('../pathUtils', async () => ({
  generateChatSessionId: vi.fn(() => 'chatSession_20260319010101_test-device_abc123xyz'),
  isValidChatSessionId: vi.fn(() => true),
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

import { importChatSessionFromFile } from '../agentAssetsImporter';
import { chatSessionStore } from '../../chat/chatSessionStore';

const mockCreateSession = chatSessionStore.createSession as ReturnType<typeof vi.fn>;

function makeValidFileContent() {
  return JSON.stringify({
    chatSession_id: 'chatSession_20260318010101_device_abc',
    last_updated: '2026-03-18T01:01:01.000Z',
    title: 'Test Session',
    chat_history: [],
    context_history: [],
  });
}

describe('importChatSessionFromFile edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(true);
    (fs.promises.readFile as any).mockResolvedValue(makeValidFileContent());
    mockCreateSession.mockResolvedValue({
      alias: 'alice',
      chatId: 'chat_1',
      month: '202603',
      metadata: {
        chatSession_id: 'chatSession_20260319010101_test-device_abc123xyz',
        title: 'Test Session',
        last_updated: '2026-03-19T01:01:01.000Z',
        readStatus: 'read',
        source: { type: 'local' },
      },
    });
  });

  it('returns error when alias is missing', async () => {
    const result = await importChatSessionFromFile('', 'chat_1', '/tmp/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameters');
  });

  it('returns error when chatId is missing', async () => {
    const result = await importChatSessionFromFile('alice', '', '/tmp/file.json');
    expect(result.success).toBe(false);
  });

  it('returns error when jsonFilePath is missing', async () => {
    const result = await importChatSessionFromFile('alice', 'chat_1', '');
    expect(result.success).toBe(false);
  });

  it('returns error when file does not exist', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    const result = await importChatSessionFromFile('alice', 'chat_1', '/no/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when file content is not valid JSON structure', async () => {
    (fs.promises.readFile as any).mockResolvedValue(JSON.stringify({ invalid: true }));
    const result = await importChatSessionFromFile('alice', 'chat_1', '/tmp/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('returns error when chatSession_id format is invalid', async () => {
    const { isValidChatSessionId } = await import('../pathUtils');
    (isValidChatSessionId as any).mockReturnValueOnce(false);
    const result = await importChatSessionFromFile('alice', 'chat_1', '/tmp/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid ChatSession ID');
  });

  it('returns error when createSession returns null', async () => {
    // Ensure valid chatSessionId check passes
    const { isValidChatSessionId } = await import('../pathUtils');
    (isValidChatSessionId as any).mockReturnValue(true);
    mockCreateSession.mockResolvedValue(null);
    const result = await importChatSessionFromFile('alice', 'chat_1', '/tmp/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('catches and returns errors from readFile', async () => {
    (fs.promises.readFile as any).mockRejectedValue(new Error('Disk read error'));
    const result = await importChatSessionFromFile('alice', 'chat_1', '/tmp/file.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Disk read error');
  });
});
