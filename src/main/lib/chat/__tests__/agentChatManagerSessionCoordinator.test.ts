vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getChatConfig: vi.fn(),
  },
}));

import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { AgentChatManagerSessionCoordinator } from '../agentChatManagerSessionCoordinator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('AgentChatManagerSessionCoordinator', () => {
  const onIdleTimeout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createCoordinator() {
    return new AgentChatManagerSessionCoordinator(
      {
        onIdleTimeout,
        isMainWindowForeground: () => true,
        getMainWindowState: () => ({
          hasWindow: true,
          destroyed: false,
          visible: true,
          minimized: false,
          focused: true,
        }),
      },
      1000,
    );
  }

  it('reuses new-chat session ids until exited', () => {
    const coordinator = createCoordinator();
    const generated = ['session_1', 'session_2'];

    expect(coordinator.getOrCreateNewChatSessionId('chat_1', () => generated.shift()!)).toBe('session_1');
    expect(coordinator.getOrCreateNewChatSessionId('chat_1', () => generated.shift()!)).toBe('session_1');

    expect(coordinator.exitNewChatSession('chat_1', 'session_1')).toEqual({
      success: true,
      existingChatSessionId: 'session_1',
    });
    expect(coordinator.getOrCreateNewChatSessionId('chat_1', () => generated.shift()!)).toBe('session_2');
  });

  it('returns the existing new-chat session id on exit mismatch', () => {
    const coordinator = createCoordinator();
    coordinator.getOrCreateNewChatSessionId('chat_1', () => 'session_1');

    expect(coordinator.exitNewChatSession('chat_1', 'session_other')).toEqual({
      success: false,
      existingChatSessionId: 'session_1',
    });
  });

  it('marks blurred active sessions unread only after completion', () => {
    const coordinator = createCoordinator();

    coordinator.handleSessionLostFocus('session_1', 'sending_response', 'interactive');

    expect(coordinator.hasPendingUnread('session_1')).toBe(true);
    expect(coordinator.shouldMarkUnreadAfterCompletion('session_1', 'idle', 1)).toBe(true);
    expect(coordinator.hasPendingUnread('session_1')).toBe(true);

    coordinator.clearPendingUnread('session_1');
    expect(coordinator.hasPendingUnread('session_1')).toBe(false);
  });

  it('treats repeated sending_response transitions as idempotent idle-timer cancellation', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();

    coordinator.handleStatusChange('session_1', 'idle', 'interactive');
    expect(coordinator.hasIdleTimer('session_1')).toBe(true);

    coordinator.handleStatusChange('session_1', 'sending_response', 'interactive');
    coordinator.handleStatusChange('session_1', 'sending_response', 'interactive');

    expect(coordinator.hasIdleTimer('session_1')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(onIdleTimeout).not.toHaveBeenCalled();
  });

  it('creates chat session directories under the agent workspace', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = path.join(os.tmpdir(), `openkosmos-agentchat-${Date.now()}`);
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: { workspace: tmpRoot },
    });

    const result = await coordinator.ensureChatSessionDirectory(
      'alias',
      'chat_1',
      'chatSession_20260405235959_device_random',
    );

    expect(result).toContain(`${path.sep}202604${path.sep}`);
  });

  it('forks the session workspace when the source directory exists', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-fork-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: { workspace: tmpRoot },
    });

    const sourceSessionId = 'chatSession_20260405235959_device_source';
    const targetSessionId = 'chatSession_20260405240000_device_target';
    const sourceDir = path.join(tmpRoot, '202604', sourceSessionId);
    const nestedDir = path.join(sourceDir, 'notes');
    const nestedFile = path.join(nestedDir, 'todo.txt');

    try {
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(nestedFile, 'fork me', 'utf8');

      const targetDir = await coordinator.forkChatSessionDirectory(
        'alias',
        'chat_1',
        sourceSessionId,
        targetSessionId,
      );

      expect(targetDir).toBe(path.join(tmpRoot, '202604', targetSessionId));
      expect(fs.existsSync(path.join(targetDir!, 'notes', 'todo.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(targetDir!, 'notes', 'todo.txt'), 'utf8')).toBe('fork me');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('creates an empty target session workspace when the fork source directory is missing', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-empty-fork-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: { workspace: tmpRoot },
    });

    try {
      const targetDir = await coordinator.forkChatSessionDirectory(
        'alias',
        'chat_1',
        'chatSession_20260405235959_device_source',
        'chatSession_20260406000000_device_target',
      );

      expect(targetDir).toBe(path.join(tmpRoot, '202604', 'chatSession_20260406000000_device_target'));
      expect(fs.existsSync(targetDir!)).toBe(true);
      expect(fs.readdirSync(targetDir!)).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('returns null when the fork target directory already contains data', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-collision-fork-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({
      agent: { workspace: tmpRoot },
    });

    const sourceSessionId = 'chatSession_20260405235959_device_source';
    const targetSessionId = 'chatSession_20260406000000_device_target';
    const sourceDir = path.join(tmpRoot, '202604', sourceSessionId);
    const targetDir = path.join(tmpRoot, '202604', targetSessionId);

    try {
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'source.txt'), 'source', 'utf8');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'existing.txt'), 'existing', 'utf8');

      const result = await coordinator.forkChatSessionDirectory(
        'alias',
        'chat_1',
        sourceSessionId,
        targetSessionId,
      );

      expect(result).toBeNull();
      expect(fs.readFileSync(path.join(targetDir, 'existing.txt'), 'utf8')).toBe('existing');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});