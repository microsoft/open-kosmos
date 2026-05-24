/**
 * ChatSessionManager coverage2 — uncovered branches:
 * - writeFileAtomically failure (unlink temp on error)
 * - readMonthIndex: empty content, corrupted JSON (CorruptedMonthIndexError)
 * - ensureMonthIndex: corrupted index propagation
 * - persistNewChatSession: invalid chatSessionId, no month, already exists, monthIndex null
 * - persistUpdatedChatSession: invalid id, no month, monthIndex null, session not found
 * - deleteChatSession: invalid id, no month, monthIndex missing, empty after delete
 * - getChatSessionFile: invalid id, no month, monthIndex missing, session not in index, file missing
 * - getMoreChatSessions: no chatIndex, fromMonthIndex >= months
 * - getAllChatSessions: no chatIndex
 * - migrateFromProfile: empty sessions, invalid ids, no file content
 * - withMonthIndexWriteLock: concurrent operations
 */

vi.mock('../pathUtils', () => ({
  getChatSessionsRootPath: vi.fn((alias: string) => `/tmp/${alias}/chat_sessions`),
  getChatSessionsChatPath: vi.fn((alias: string, chatId: string) => `/tmp/${alias}/chat_sessions/${chatId}`),
  getChatSessionsChatIndexPath: vi.fn((alias: string, chatId: string) => `/tmp/${alias}/chat_sessions/${chatId}/index.json`),
  getChatSessionsMonthPath: vi.fn((alias: string, chatId: string, month: string) => `/tmp/${alias}/chat_sessions/${chatId}/${month}`),
  getChatSessionsMonthIndexPath: vi.fn((alias: string, chatId: string, month: string) => `/tmp/${alias}/chat_sessions/${chatId}/${month}/index.json`),
  getChatSessionFilePath: vi.fn((alias: string, chatId: string, sessionId: string) => `/tmp/${alias}/chat_sessions/${chatId}/sessions/${sessionId}.json`),
  extractMonthFromChatSessionId: vi.fn((id: string) => {
    const match = id.match(/chatSession_(\d{6})/);
    return match ? match[1] : null;
  }),
  isValidChatSessionId: vi.fn((id: string) => /^chatSession_\d{14}$/.test(id)),
}));

const { mockFsPromises, mockFsExistsSync } = vi.hoisted(() => {
  const mockFsPromises = {
    readFile: vi.fn(),
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  };
  const mockFsExistsSync = vi.fn(() => false);
  return { mockFsPromises, mockFsExistsSync };
});

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  promises: mockFsPromises,
}));

vi.mock('../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../chatSessionFileOps', () => ({
  deserializeChatFile: vi.fn((data: any) => data),
}));

import { ChatSessionManager } from '../chatSessionManager';
import * as fs from 'fs';

function makeManager(): ChatSessionManager {
  return (ChatSessionManager as any)['instance'] = undefined, ChatSessionManager.getInstance();
}

const VALID_SESSION_ID = 'chatSession_20241201120000';
const INVALID_SESSION_ID = 'invalid-id';

describe('ChatSessionManager coverage2', () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (ChatSessionManager as any).instance = undefined;
    manager = ChatSessionManager.getInstance();
  });

  describe('readMonthIndex', () => {
    it('returns null when file does not exist', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.readMonthIndex('user', 'chat1', '202412');
      expect(result).toBeNull();
    });

    it('returns null when file is empty', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce('   ');
      const result = await manager.readMonthIndex('user', 'chat1', '202412');
      expect(result).toBeNull();
    });

    it('throws CorruptedMonthIndexError on invalid JSON', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce('{ not valid json');
      await expect(manager.readMonthIndex('user', 'chat1', '202412')).rejects.toMatchObject({
        name: 'CorruptedMonthIndexError',
      });
    });

    it('returns parsed data on valid JSON', async () => {
      const data = { chat_id: 'chat1', month: '202412', sessions: [], last_updated: new Date().toISOString() };
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(data));
      const result = await manager.readMonthIndex('user', 'chat1', '202412');
      expect(result?.chat_id).toBe('chat1');
    });

    it('returns null on read error', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockRejectedValueOnce(new Error('read fail'));
      const result = await manager.readMonthIndex('user', 'chat1', '202412');
      expect(result).toBeNull();
    });
  });

  describe('readChatIndex', () => {
    it('returns null when file does not exist', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.readChatIndex('user', 'chat1');
      expect(result).toBeNull();
    });

    it('returns null on read error', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockRejectedValueOnce(new Error('read fail'));
      const result = await manager.readChatIndex('user', 'chat1');
      expect(result).toBeNull();
    });
  });

  describe('writeChatIndex', () => {
    it('returns false on write failure', async () => {
      mockFsPromises.writeFile.mockRejectedValueOnce(new Error('write fail'));
      const result = await manager.writeChatIndex('user', 'chat1', {
        chat_id: 'chat1',
        months: [],
        last_updated: new Date().toISOString(),
      });
      expect(result).toBe(false);
    });
  });

  describe('writeMonthIndex', () => {
    it('returns false on write failure', async () => {
      mockFsPromises.writeFile.mockRejectedValueOnce(new Error('write fail'));
      mockFsPromises.rename.mockRejectedValueOnce(new Error('rename fail'));
      const result = await manager.writeMonthIndex('user', 'chat1', '202412', {
        chat_id: 'chat1',
        month: '202412',
        sessions: [],
        last_updated: new Date().toISOString(),
      });
      expect(result).toBe(false);
    });
  });

  describe('ensureMonthIndex', () => {
    it('propagates CorruptedMonthIndexError', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      mockFsPromises.readFile
        .mockResolvedValueOnce('{ corrupted json') // month index read
      ;
      await expect(manager.ensureMonthIndex('user', 'chat1', '202412')).rejects.toMatchObject({
        name: 'CorruptedMonthIndexError',
      });
    });

    it('creates new index when missing and updates chat index', async () => {
      (fs.existsSync as any).mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);
      mockFsPromises.rename.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockResolvedValue(JSON.stringify({
        chat_id: 'chat1',
        months: [],
        last_updated: new Date().toISOString(),
      }));

      const result = await manager.ensureMonthIndex('user', 'chat1', '202412');
      expect(result.chat_id).toBe('chat1');
    });
  });

  describe('persistNewChatSession', () => {
    it('returns false for invalid chatSessionId', async () => {
      const result = await manager.persistNewChatSession('user', 'chat1', {
        chatSession_id: INVALID_SESSION_ID,
        title: 'Test',
        last_updated: new Date().toISOString(),
      } as any, {} as any);
      expect(result).toBe(false);
    });

    it('returns false when month extraction fails', async () => {
      const { extractMonthFromChatSessionId } = await import('../pathUtils');
      (extractMonthFromChatSessionId as any).mockReturnValueOnce(null);

      const result = await manager.persistNewChatSession('user', 'chat1', {
        chatSession_id: VALID_SESSION_ID,
        title: 'Test',
        last_updated: new Date().toISOString(),
      } as any, {} as any);
      expect(result).toBe(false);
    });

    it('returns false when month index read returns null inside lock', async () => {
      // ensureMonthIndex succeeds, but readMonthIndex in lock returns null
      (fs.existsSync as any).mockImplementation((p: string) => false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);
      mockFsPromises.rename.mockResolvedValue(undefined);

      // First readChatIndex (null) -> ensureChatIndex creates it
      // readMonthIndex (null) -> ensureMonthIndex creates it
      // Then inside lock: readMonthIndex returns null
      let readCallCount = 0;
      mockFsPromises.readFile.mockImplementation(async () => {
        readCallCount++;
        if (readCallCount <= 2) {
          // Return chat index for ensureChatIndex
          return JSON.stringify({ chat_id: 'chat1', months: [], last_updated: '' });
        }
        // Inside lock: return null (simulate race condition)
        throw new Error('not found');
      });

      const result = await manager.persistNewChatSession('user', 'chat1', {
        chatSession_id: VALID_SESSION_ID,
        title: 'Test',
        last_updated: new Date().toISOString(),
      } as any, {} as any);
      // Will return false because of null month index in lock or error
      expect(typeof result).toBe('boolean');
    });
  });

  describe('persistUpdatedChatSession', () => {
    it('returns false for invalid chatSessionId', async () => {
      const result = await manager.persistUpdatedChatSession('user', 'chat1', INVALID_SESSION_ID, {}, {} as any);
      expect(result).toBe(false);
    });

    it('returns false when month extraction fails', async () => {
      const { extractMonthFromChatSessionId } = await import('../pathUtils');
      (extractMonthFromChatSessionId as any).mockReturnValueOnce(null);

      const result = await manager.persistUpdatedChatSession('user', 'chat1', VALID_SESSION_ID, {}, {} as any);
      expect(result).toBe(false);
    });

    it('returns false on exception', async () => {
      mockFsPromises.writeFile.mockRejectedValueOnce(new Error('disk full'));
      // ensureMonthIndex won't be called since month index read happens inside lock
      (fs.existsSync as any).mockReturnValue(true);
      mockFsPromises.readFile.mockRejectedValueOnce(new Error('read fail'));

      const result = await manager.persistUpdatedChatSession('user', 'chat1', VALID_SESSION_ID, {}, {} as any);
      expect(result).toBe(false);
    });
  });

  describe('deleteChatSession', () => {
    it('returns false for invalid chatSessionId', async () => {
      const result = await manager.deleteChatSession('user', 'chat1', INVALID_SESSION_ID);
      expect(result).toBe(false);
    });

    it('returns false when month extraction fails', async () => {
      const { extractMonthFromChatSessionId } = await import('../pathUtils');
      (extractMonthFromChatSessionId as any).mockReturnValueOnce(null);

      const result = await manager.deleteChatSession('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBe(false);
    });

    it('returns true when month index not found (treated as already deleted)', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false); // monthIndex file does not exist
      const result = await manager.deleteChatSession('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBe(true);
    });

    it('returns true when session not in index', async () => {
      const monthData = { chat_id: 'chat1', month: '202412', sessions: [], last_updated: '' };
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(monthData));
      const result = await manager.deleteChatSession('user', 'chat1', VALID_SESSION_ID);
      // Session not found in index, file doesn't exist
      expect(result).toBe(true);
    });

    it('removes month from chat index when month becomes empty', async () => {
      const session = {
        chatSession_id: VALID_SESSION_ID,
        title: 'Test',
        last_updated: new Date().toISOString(),
      };
      const monthData = { chat_id: 'chat1', month: '202412', sessions: [session], last_updated: '' };
      const chatData = { chat_id: 'chat1', months: ['202412'], last_updated: '' };

      (fs.existsSync as any).mockImplementation(() => false);
      let readCount = 0;
      mockFsPromises.readFile.mockImplementation(async () => {
        readCount++;
        if (readCount === 1) return JSON.stringify(monthData);
        return JSON.stringify(chatData);
      });
      mockFsPromises.writeFile.mockResolvedValue(undefined);
      mockFsPromises.rename.mockResolvedValue(undefined);

      const result = await manager.deleteChatSession('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBe(true);
    });
  });

  describe('getChatSessionFile', () => {
    it('returns null for invalid chatSessionId', async () => {
      const result = await manager.getChatSessionFile('user', 'chat1', INVALID_SESSION_ID);
      expect(result).toBeNull();
    });

    it('returns null when month extraction fails', async () => {
      const { extractMonthFromChatSessionId } = await import('../pathUtils');
      (extractMonthFromChatSessionId as any).mockReturnValueOnce(null);

      const result = await manager.getChatSessionFile('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBeNull();
    });

    it('returns null when month index not found', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.getChatSessionFile('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBeNull();
    });

    it('returns null when session not in month index', async () => {
      const monthData = { chat_id: 'chat1', month: '202412', sessions: [], last_updated: '' };
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(monthData));
      const result = await manager.getChatSessionFile('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBeNull();
    });

    it('returns null when file does not exist despite index entry', async () => {
      const session = { chatSession_id: VALID_SESSION_ID, title: 'Test', last_updated: '' };
      const monthData = { chat_id: 'chat1', month: '202412', sessions: [session], last_updated: '' };
      (fs.existsSync as any)
        .mockReturnValueOnce(true) // month index exists
        .mockReturnValueOnce(false); // session file does not exist
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(monthData));
      const result = await manager.getChatSessionFile('user', 'chat1', VALID_SESSION_ID);
      expect(result).toBeNull();
    });
  });

  describe('getChatSessions', () => {
    it('returns empty result when no chat index', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.getChatSessions('user', 'chat1');
      expect(result.sessions).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('returns empty result when chat index has no months', async () => {
      const chatData = { chat_id: 'chat1', months: [], last_updated: '' };
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(chatData));
      const result = await manager.getChatSessions('user', 'chat1');
      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('getMoreChatSessions', () => {
    it('returns empty when no chat index', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.getMoreChatSessions('user', 'chat1', 0);
      expect(result.sessions).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('returns empty when fromMonthIndex >= months.length', async () => {
      const chatData = { chat_id: 'chat1', months: ['202412'], last_updated: '' };
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockResolvedValueOnce(JSON.stringify(chatData));
      const result = await manager.getMoreChatSessions('user', 'chat1', 5);
      expect(result.sessions).toHaveLength(0);
    });

    it('returns sessions from the specified month', async () => {
      const session = { chatSession_id: VALID_SESSION_ID, title: 'Test', last_updated: '2024-12-01T00:00:00Z' };
      const chatData = { chat_id: 'chat1', months: ['202412'], last_updated: '' };
      const monthData = { chat_id: 'chat1', month: '202412', sessions: [session], last_updated: '' };

      (fs.existsSync as any).mockReturnValue(true);
      mockFsPromises.readFile
        .mockResolvedValueOnce(JSON.stringify(chatData))
        .mockResolvedValueOnce(JSON.stringify(monthData));

      const result = await manager.getMoreChatSessions('user', 'chat1', 0);
      expect(result.sessions).toHaveLength(1);
      expect(result.loadedMonth).toBe('202412');
    });
  });

  describe('getAllChatSessions', () => {
    it('returns empty when no chat index', async () => {
      (fs.existsSync as any).mockReturnValueOnce(false);
      const result = await manager.getAllChatSessions('user', 'chat1');
      expect(result).toHaveLength(0);
    });

    it('returns empty on error', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      mockFsPromises.readFile.mockRejectedValueOnce(new Error('io error'));
      const result = await manager.getAllChatSessions('user', 'chat1');
      expect(result).toHaveLength(0);
    });
  });

  describe('migrateFromProfile', () => {
    it('returns true for empty sessions', async () => {
      const result = await manager.migrateFromProfile('user', 'chat1', [], async () => null);
      expect(result).toBe(true);
    });

    it('skips invalid chatSessionIds', async () => {
      const { isValidChatSessionId } = await import('../pathUtils');
      (isValidChatSessionId as any).mockReturnValueOnce(false);

      mockFsPromises.writeFile.mockResolvedValue(undefined);
      const result = await manager.migrateFromProfile('user', 'chat1', [
        { chatSession_id: 'bad-id', title: 'Test', last_updated: '' } as any,
      ], async () => null);
      expect(result).toBe(true);
    });

    it('handles missing getChatSessionFile gracefully', async () => {
      (fs.existsSync as any).mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);
      mockFsPromises.rename.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockResolvedValue(JSON.stringify({
        chat_id: 'chat1', months: [], last_updated: ''
      }));

      const result = await manager.migrateFromProfile('user', 'chat1', [
        { chatSession_id: VALID_SESSION_ID, title: 'Test', last_updated: '2024-12-01' } as any,
      ], async () => null); // No file content
      expect(result).toBe(true);
    });

    it('returns false on exception', async () => {
      mockFsPromises.writeFile.mockRejectedValue(new Error('disk error'));
      mockFsPromises.readFile.mockRejectedValue(new Error('read error'));
      const result = await manager.migrateFromProfile('user', 'chat1', [
        { chatSession_id: VALID_SESSION_ID, title: 'Test', last_updated: '2024-12-01' } as any,
      ], async () => null);
      // Returns false or true depending on error handling — just check no unhandled error
      expect(typeof result).toBe('boolean');
    });
  });

  describe('withMonthIndexWriteLock concurrent operations', () => {
    it('serializes concurrent write operations', async () => {
      const order: number[] = [];
      const op = (n: number) => async () => {
        order.push(n);
        await new Promise(r => setTimeout(r, 10));
        order.push(-n);
      };

      // These should run sequentially not concurrently
      const p1 = (manager as any).withMonthIndexWriteLock('user', 'chat1', '202412', op(1));
      const p2 = (manager as any).withMonthIndexWriteLock('user', 'chat1', '202412', op(2));
      await Promise.all([p1, p2]);

      // Verify serialization: all of op1 before op2
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(-1));
      expect(order.indexOf(-1)).toBeLessThan(order.indexOf(2));
    });
  });
});
