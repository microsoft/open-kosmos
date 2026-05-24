import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

// Use a real temp directory for electron
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatFileOps-userData-'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => testUserDataDir) },
}));

import {
  ChatSessionFileOps,
  ChatSessionFile,
  deserializeChatFile,
  readChatSessionFile,
  writeChatSessionFile,
  updateChatSessionFile,
  deleteChatSessionFile,
  getChatSessionBasePath,
} from '../chatSessionFileOps';

const VALID_SESSION_ID = 'chatSession_20260101120000_device_abc123';

function makeValidSession(overrides: Partial<ChatSessionFile> = {}): ChatSessionFile {
  return {
    chatSession_id: VALID_SESSION_ID,
    last_updated: '2026-01-01T00:00:00Z',
    title: 'Test Session',
    chat_history: [],
    context_history: [],
    ...overrides,
  };
}

describe('deserializeChatFile', () => {
  it('deserializes chat_history and context_history messages', () => {
    const raw = {
      chatSession_id: VALID_SESSION_ID,
      last_updated: '2026-01-01T00:00:00Z',
      title: 'T',
      chat_history: [],
      context_history: [],
    };
    const result = deserializeChatFile(raw);
    expect(Array.isArray(result.chat_history)).toBe(true);
    expect(Array.isArray(result.context_history)).toBe(true);
  });

  it('handles missing chat_history/context_history gracefully', () => {
    const raw = { chatSession_id: VALID_SESSION_ID, last_updated: '', title: '' };
    const result = deserializeChatFile(raw);
    expect(result.chat_history).toEqual([]);
    expect(result.context_history).toEqual([]);
  });
});

describe('ChatSessionFileOps', () => {
  beforeEach(() => {
    // Reset instances to avoid cross-test contamination
    (ChatSessionFileOps as any).instances = new Map();
  });

  describe('getInstance', () => {
    it('returns same instance for same alias', () => {
      const a = ChatSessionFileOps.getInstance('alice');
      const b = ChatSessionFileOps.getInstance('alice');
      expect(a).toBe(b);
    });

    it('returns different instances for different aliases', () => {
      const a = ChatSessionFileOps.getInstance('alice');
      const b = ChatSessionFileOps.getInstance('bob');
      expect(a).not.toBe(b);
    });
  });

  describe('getUserAlias', () => {
    it('returns the alias', () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      expect(ops.getUserAlias()).toBe('alice');
    });
  });

  describe('getBasePath', () => {
    it('returns a path containing chat_sessions', () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      expect(ops.getBasePath()).toContain('chat_sessions');
    });
  });

  describe('readChatSession', () => {
    it('returns error for invalid chatSession_id', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const result = await ops.readChatSession('invalid_id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ChatSession ID');
    });

    it('returns error when file does not exist', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const result = await ops.readChatSession(VALID_SESSION_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('reads and returns a valid session', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const session = makeValidSession();
      const writeResult = await ops.writeChatSession(session);
      expect(writeResult.success).toBe(true);

      const readResult = await ops.readChatSession(VALID_SESSION_ID);
      expect(readResult.success).toBe(true);
      expect(readResult.data?.chatSession_id).toBe(VALID_SESSION_ID);
    });
  });

  describe('writeChatSession', () => {
    it('returns error for invalid structure', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const result = await ops.writeChatSession({ chatSession_id: 'bad', title: '', last_updated: '', chat_history: [], context_history: [] });
      expect(result.success).toBe(false);
    });

    it('writes a valid session successfully', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const session = makeValidSession();
      const result = await ops.writeChatSession(session);
      expect(result.success).toBe(true);
    });
  });

  describe('updateChatSession', () => {
    it('returns error when session does not exist', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      // Reset instances to clear previous writes
      (ChatSessionFileOps as any).instances = new Map();
      const freshOps = ChatSessionFileOps.getInstance('bob');
      const result = await freshOps.updateChatSession(VALID_SESSION_ID, { title: 'New' });
      expect(result.success).toBe(false);
    });

    it('updates an existing session', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      await ops.writeChatSession(makeValidSession());
      const result = await ops.updateChatSession(VALID_SESSION_ID, { title: 'Updated' });
      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Updated');
    });
  });

  describe('deleteChatSession', () => {
    it('returns error for invalid ID', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const result = await ops.deleteChatSession('invalid');
      expect(result.success).toBe(false);
    });

    it('returns error when file not found', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      const result = await ops.deleteChatSession('chatSession_20260201120000_device_xyz12');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('deletes existing file', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      await ops.writeChatSession(makeValidSession());
      const result = await ops.deleteChatSession(VALID_SESSION_ID);
      expect(result.success).toBe(true);

      const checkResult = await ops.readChatSession(VALID_SESSION_ID);
      expect(checkResult.success).toBe(false);
    });
  });

  describe('chatSessionExists', () => {
    it('returns false for invalid ID', () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      expect(ops.chatSessionExists('invalid')).toBe(false);
    });

    it('returns false when file does not exist', () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      expect(ops.chatSessionExists('chatSession_20260301120000_device_abc99')).toBe(false);
    });

    it('returns true when file exists', async () => {
      const ops = ChatSessionFileOps.getInstance('alice');
      await ops.writeChatSession(makeValidSession());
      expect(ops.chatSessionExists(VALID_SESSION_ID)).toBe(true);
    });
  });
});

describe('convenience functions', () => {
  beforeEach(() => {
    (ChatSessionFileOps as any).instances = new Map();
  });

  it('readChatSessionFile proxies to ChatSessionFileOps', async () => {
    const result = await readChatSessionFile('alice', 'invalid');
    expect(result.success).toBe(false);
  });

  it('writeChatSessionFile proxies to ChatSessionFileOps', async () => {
    const session = makeValidSession({ chatSession_id: 'chatSession_20260401120000_device_abc1' });
    const result = await writeChatSessionFile('alice', session);
    expect(result.success).toBe(true);
  });

  it('updateChatSessionFile proxies to ChatSessionFileOps', async () => {
    // Write a session first
    const sessionId = 'chatSession_20260501120000_device_abc1';
    await writeChatSessionFile('alice', makeValidSession({ chatSession_id: sessionId }));
    const result = await updateChatSessionFile('alice', sessionId, { title: 'New' });
    expect(result.success).toBe(true);
  });

  it('deleteChatSessionFile proxies to ChatSessionFileOps', async () => {
    const result = await deleteChatSessionFile('alice', 'invalid');
    expect(result.success).toBe(false);
  });

  it('getChatSessionBasePath returns path', () => {
    const result = getChatSessionBasePath('alice');
    expect(typeof result).toBe('string');
    expect(result).toContain('chat_sessions');
  });
});
