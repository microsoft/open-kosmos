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
    // clearAllMocks keeps implementations; reset getChatConfig so throwing
    // implementations from one test cannot leak into the next.
    (profileCacheManager.getChatConfig as Mock).mockReset();
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

  it('creates chat session directories under the chat workspace', async () => {
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

  it('exposes the current instance and chat session id after activation', () => {
    const coordinator = createCoordinator();
    expect(coordinator.getCurrentInstance()).toBeNull();

    const instance = {} as never;
    coordinator.activateSession('session_1', instance);

    expect(coordinator.getCurrentInstance()).toBe(instance);
    expect(coordinator.getCurrentChatSessionId()).toBe('session_1');
  });

  it('clears the current session only when the chat session id matches', () => {
    const coordinator = createCoordinator();
    const instance = {} as never;
    coordinator.activateSession('session_1', instance);

    coordinator.clearCurrentSession('session_other');
    expect(coordinator.getCurrentInstance()).toBe(instance);

    coordinator.clearCurrentSession('session_1');
    expect(coordinator.getCurrentInstance()).toBeNull();
    expect(coordinator.getCurrentChatSessionId()).toBeNull();
  });

  it('returns the registered or null new-chat session id', () => {
    const coordinator = createCoordinator();
    expect(coordinator.getNewChatSessionId('chat_1')).toBeNull();

    coordinator.getOrCreateNewChatSessionId('chat_1', () => 'session_1');
    expect(coordinator.getNewChatSessionId('chat_1')).toBe('session_1');
  });

  it('normalizes a missing new-chat session id to null on exit mismatch', () => {
    const coordinator = createCoordinator();
    expect(coordinator.exitNewChatSession('chat_unknown', 'whatever')).toEqual({
      success: false,
      existingChatSessionId: null,
    });
  });

  it('normalizes an empty registered new-chat session id to null on successful exit', () => {
    const coordinator = createCoordinator();
    expect(coordinator.getOrCreateNewChatSessionId('chat_empty', () => '')).toBe('');
    expect(coordinator.exitNewChatSession('chat_empty', '')).toEqual({
      success: true,
      existingChatSessionId: null,
    });
  });

  it('clears pending unread for the current session and no-ops without one', () => {
    const coordinator = createCoordinator();
    coordinator.clearPendingUnreadForCurrentSession();

    coordinator.activateSession('session_1', {} as never);
    coordinator.handleSessionLostFocus('session_1', 'sending_response', 'interactive');
    expect(coordinator.hasPendingUnread('session_1')).toBe(true);

    coordinator.clearPendingUnreadForCurrentSession();
    expect(coordinator.hasPendingUnread('session_1')).toBe(false);
  });

  it('routes idle lost-focus events through status change without marking unread', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();

    coordinator.handleSessionLostFocus('session_1', 'idle', 'interactive');

    expect(coordinator.hasPendingUnread('session_1')).toBe(false);
    expect(coordinator.hasIdleTimer('session_1')).toBe(true);
  });

  it('protects a pending new-chat session id from idle cancellation', () => {
    const coordinator = createCoordinator();
    const newSessionId = coordinator.getOrCreateNewChatSessionId('chat_1', () => 'session_new');
    expect(coordinator.isProtectedSession(newSessionId, 'interactive')).toBe(true);
  });

  it('protects the current foreground interactive session', () => {
    const coordinator = createCoordinator();
    coordinator.activateSession('session_1', {} as never);
    expect(coordinator.isProtectedSession('session_1', 'interactive')).toBe(true);
  });

  it('does not protect the current session when the window is not foreground', () => {
    const coordinator = new AgentChatManagerSessionCoordinator(
      {
        onIdleTimeout,
        isMainWindowForeground: () => false,
        getMainWindowState: () => ({
          hasWindow: true,
          destroyed: false,
          visible: false,
          minimized: true,
          focused: false,
        }),
      },
      1000,
    );
    coordinator.activateSession('session_1', {} as never);
    expect(coordinator.isProtectedSession('session_1', 'interactive')).toBe(false);
  });

  it('is not protected for non-interactive runtime modes', () => {
    const coordinator = createCoordinator();
    expect(coordinator.isProtectedSession('session_1', 'scheduled-silent')).toBe(false);
    expect(coordinator.isProtectedSession('session_1', null)).toBe(false);
  });

  it('invokes the idle timeout callback when the timer elapses', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();
    coordinator.handleStatusChange('session_1', 'idle', 'interactive');
    vi.advanceTimersByTime(1000);
    expect(onIdleTimeout).toHaveBeenCalledWith('session_1');
  });

  it('clears idle timers and resets all coordinator state', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();
    coordinator.handleStatusChange('session_1', 'idle', 'interactive');
    coordinator.activateSession('session_2', {} as never);
    expect(coordinator.hasIdleTimer('session_1')).toBe(true);

    coordinator.reset();
    expect(coordinator.hasIdleTimer('session_1')).toBe(false);
    expect(coordinator.getCurrentInstance()).toBeNull();
    expect(coordinator.getCurrentChatSessionId()).toBeNull();
  });

  it('logs and continues when clearing an idle timer throws during reset', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();
    coordinator.handleStatusChange('session_1', 'idle', 'interactive');

    const spy = vi.spyOn(global, 'clearTimeout').mockImplementationOnce(() => {
      throw new Error('clear fail');
    });
    coordinator.reset();
    spy.mockRestore();

    expect(coordinator.hasIdleTimer('session_1')).toBe(false);
  });

  it('stringifies non-Error failures when clearing timers during reset', () => {
    vi.useFakeTimers();
    const coordinator = createCoordinator();
    coordinator.handleStatusChange('session_1', 'idle', 'interactive');

    const spy = vi.spyOn(global, 'clearTimeout').mockImplementationOnce(() => {
      throw 'clear-str';
    });
    coordinator.reset();
    spy.mockRestore();

    expect(coordinator.hasIdleTimer('session_1')).toBe(false);
  });

  it('returns null when there is no current user alias', async () => {
    const coordinator = createCoordinator();
    const result = await coordinator.ensureChatSessionDirectory(
      null,
      'chat_1',
      'chatSession_20260405235959_device_x',
    );
    expect(result).toBeNull();
  });

  it('returns null when the resolved agent has no workspace path', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: {} });
    const result = await coordinator.ensureChatSessionDirectory(
      'alias',
      'chat_1',
      'chatSession_20260405235959_device_x',
    );
    expect(result).toBeNull();
  });

  it('returns null when the workspace path is only whitespace', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: { workspace: '   ' } });
    const result = await coordinator.ensureChatSessionDirectory(
      'alias',
      'chat_1',
      'chatSession_20260405235959_device_x',
    );
    expect(result).toBeNull();
  });

  it('returns null when the chat session id has no parseable month', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-badsession-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: { workspace: tmpRoot } });
    try {
      const result = await coordinator.ensureChatSessionDirectory('alias', 'chat_1', 'not-a-valid-session-id');
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('reuses existing month and session directories on repeated ensure calls', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-reuse-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: { workspace: tmpRoot } });
    try {
      const first = await coordinator.ensureChatSessionDirectory(
        'alias',
        'chat_1',
        'chatSession_20260405235959_device_x',
      );
      const second = await coordinator.ensureChatSessionDirectory(
        'alias',
        'chat_1',
        'chatSession_20260405235959_device_x',
      );
      expect(second).toBe(first);
      expect(fs.existsSync(second!)).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('returns null and logs when resolving the chat session directory throws', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await coordinator.ensureChatSessionDirectory(
      'alias',
      'chat_1',
      'chatSession_20260405235959_device_x',
    );
    expect(result).toBeNull();
  });

  it('returns null when resolving throws a non-Error value', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockImplementation(() => {
      throw 'nope';
    });
    const result = await coordinator.ensureChatSessionDirectory(
      'alias',
      'chat_1',
      'chatSession_20260405235959_device_x',
    );
    expect(result).toBeNull();
  });

  it('returns null when the fork target directory cannot be resolved', async () => {
    const coordinator = createCoordinator();
    const result = await coordinator.forkChatSessionDirectory(null, 'chat_1', 'src', 'tgt');
    expect(result).toBeNull();
  });

  it('returns null when forking with a missing source but a non-empty target', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-missing-src-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: { workspace: tmpRoot } });
    const targetSessionId = 'chatSession_20260406000000_device_target';
    const targetDir = path.join(tmpRoot, '202604', targetSessionId);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'existing.txt'), 'x', 'utf8');

      const result = await coordinator.forkChatSessionDirectory(
        'alias',
        'chat_1',
        'chatSession_20260405235959_device_missing',
        targetSessionId,
      );
      expect(result).toBeNull();
      expect(fs.readFileSync(path.join(targetDir, 'existing.txt'), 'utf8')).toBe('x');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('replaces an existing empty target directory when forking', async () => {
    const coordinator = createCoordinator();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-agentchat-empty-target-'));
    (profileCacheManager.getChatConfig as Mock).mockReturnValue({ agent: { workspace: tmpRoot } });
    const sourceSessionId = 'chatSession_20260405235959_device_source';
    const targetSessionId = 'chatSession_20260406000000_device_target';
    const sourceDir = path.join(tmpRoot, '202604', sourceSessionId);
    const targetDir = path.join(tmpRoot, '202604', targetSessionId);
    try {
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'a.txt'), 'data', 'utf8');
      fs.mkdirSync(targetDir, { recursive: true });

      const result = await coordinator.forkChatSessionDirectory(
        'alias',
        'chat_1',
        sourceSessionId,
        targetSessionId,
      );
      expect(result).toBe(targetDir);
      expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('data');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('returns null and logs when forking throws an Error', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockImplementation(() => {
      throw new Error('kaboom');
    });
    const result = await coordinator.forkChatSessionDirectory('alias', 'chat_1', 'src', 'tgt');
    expect(result).toBeNull();
  });

  it('stringifies non-Error fork failures', async () => {
    const coordinator = createCoordinator();
    (profileCacheManager.getChatConfig as Mock).mockImplementation(() => {
      throw 'string failure';
    });
    const result = await coordinator.forkChatSessionDirectory('alias', 'chat_1', 'src', 'tgt');
    expect(result).toBeNull();
  });
});