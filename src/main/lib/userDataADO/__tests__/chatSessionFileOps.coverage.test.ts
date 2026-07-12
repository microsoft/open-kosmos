import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const VALID_SESSION_ID = 'chatSession_20260101120000_device_abc123';

async function importChatSessionFileOps(options?: {
  appPathThrows?: boolean;
  existsSync?: ReturnType<typeof vi.fn>;
  mkdirSync?: ReturnType<typeof vi.fn>;
  readFileSync?: ReturnType<typeof vi.fn>;
  writeFileSync?: ReturnType<typeof vi.fn>;
  unlinkSync?: ReturnType<typeof vi.fn>;
  tmpDir?: string;
}) {
  vi.resetModules();
  const existsSync = options?.existsSync ?? vi.fn(() => true);
  const mkdirSync = options?.mkdirSync ?? vi.fn();
  const readFileSync = options?.readFileSync ?? vi.fn();
  const writeFileSync = options?.writeFileSync ?? vi.fn();
  const unlinkSync = options?.unlinkSync ?? vi.fn();
  const tmpDir = options?.tmpDir ?? path.join(process.cwd(), '.test-artifacts', 'chat-session-fallback');

  vi.doMock('electron', () => ({
    app: {
      getPath: options?.appPathThrows
        ? vi.fn(() => {
            throw new Error('no userData');
          })
        : vi.fn(() => path.join(process.cwd(), '.test-artifacts', 'chat-session-user-data')),
    },
  }));

  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('os')>('os');
    return {
      ...actual,
      tmpdir: vi.fn(() => tmpDir),
    };
  });

  vi.doMock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
      ...actual,
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync,
      unlinkSync,
    };
  });

  const mod = await import('../chatSessionFileOps');
  return { ...mod, mocks: { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, tmpDir } };
}

describe('chatSessionFileOps additional coverage', () => {
  it('falls back to os.tmpdir when app.getPath is unavailable', async () => {
    const { ChatSessionFileOps, mocks } = await importChatSessionFileOps({
      appPathThrows: true,
      existsSync: vi.fn(() => true),
    });

    const ops = ChatSessionFileOps.getInstance('alice');

    expect(ops.getBasePath()).toContain(mocks.tmpDir);
  });

  it('throws a descriptive constructor error when creating the directory fails', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(() => {
        throw new Error('mkdir failed');
      }),
    });

    expect(() => ChatSessionFileOps.getInstance('alice')).toThrow(
      'Failed to create chat sessions directory for user alice: mkdir failed',
    );
  });

  it('returns an invalid-structure error when a file does not match the chat session schema', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => JSON.stringify({
        chatSession_id: VALID_SESSION_ID,
        last_updated: '2026-01-01T00:00:00Z',
        title: 123,
        chat_history: [],
        context_history: [],
      })),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.readChatSession(VALID_SESSION_ID);

    expect(result).toEqual({
      success: false,
      error: `Invalid ChatSession file structure: ${VALID_SESSION_ID}`,
    });
  });

  it('returns a read error when fs.readFileSync throws', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => {
        throw new Error('read failed');
      }),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.readChatSession(VALID_SESSION_ID);

    expect(result).toEqual({
      success: false,
      error: 'Failed to read ChatSession: read failed',
    });
  });

  it('returns a write error when fs.writeFileSync throws', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(() => {
        throw new Error('write failed');
      }),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.writeChatSession({
      chatSession_id: VALID_SESSION_ID,
      last_updated: '2026-01-01T00:00:00Z',
      title: 'Needs write',
      chat_history: [],
      context_history: [],
    });

    expect(result).toEqual({
      success: false,
      error: 'Failed to write ChatSession: write failed',
    });
  });

  it('stringifies non-Error write failures', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(() => {
        throw 'write failed as string';
      }),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.writeChatSession({
      chatSession_id: VALID_SESSION_ID,
      last_updated: '2026-01-01T00:00:00Z',
      title: 'Needs write',
      chat_history: [],
      context_history: [],
    });

    expect(result).toEqual({
      success: false,
      error: 'Failed to write ChatSession: Unknown error',
    });
  });

  it('returns an update error when the read path throws unexpectedly', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn(() => true),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    vi.spyOn(ops as any, 'readChatSession').mockRejectedValue(new Error('boom'));

    const result = await ops.updateChatSession(VALID_SESSION_ID, { title: 'Updated' });

    expect(result).toEqual({
      success: false,
      error: 'Failed to update ChatSession: boom',
    });
  });

  it('returns a delete error when fs.unlinkSync throws', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn((filePath: string) => filePath.endsWith(`${VALID_SESSION_ID}.json`)),
      unlinkSync: vi.fn(() => {
        throw new Error('unlink failed');
      }),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.deleteChatSession(VALID_SESSION_ID);

    expect(result).toEqual({
      success: false,
      error: 'Failed to delete ChatSession: unlink failed',
    });
  });

  it('stringifies non-Error delete failures', async () => {
    const { ChatSessionFileOps } = await importChatSessionFileOps({
      existsSync: vi.fn((filePath: string) => filePath.endsWith(`${VALID_SESSION_ID}.json`)),
      unlinkSync: vi.fn(() => {
        throw 'unlink failed as string';
      }),
    });

    const ops = ChatSessionFileOps.getInstance('alice');
    const result = await ops.deleteChatSession(VALID_SESSION_ID);

    expect(result).toEqual({
      success: false,
      error: 'Failed to delete ChatSession: Unknown error',
    });
  });
});
