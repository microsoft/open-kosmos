vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/pathUtils', () => ({
  getUserDataPath: vi.fn(() => '/tmp/test-userdata'),
}));

// Mock fs module
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs', () => ({
  default: { promises: fsMocks },
  promises: fsMocks,
}));

import { SESSION_TTL, MAX_SESSIONS, PERSIST_DEBOUNCE } from '../types';
import {
  getSessionMapPath,
  loadSessionMap,
  persistSessionMap,
  pruneSessionMap,
  createPersistScheduler,
} from '../sessionPersistence';

describe('getSessionMapPath', () => {
  it('returns path containing alias and filename', () => {
    const result = getSessionMapPath('user1');
    expect(result).toContain('user1');
    expect(result).toContain('remoteSessionMap.json');
  });
});

describe('loadSessionMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty map when file does not exist', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));
    const map = await loadSessionMap('user1');
    expect(map.size).toBe(0);
  });

  it('returns empty map when JSON is invalid', async () => {
    fsMocks.readFile.mockResolvedValue('not-json{{{');
    const map = await loadSessionMap('user1');
    expect(map.size).toBe(0);
  });

  it('loads valid sessions that are within TTL', async () => {
    const now = Date.now();
    const entries = {
      'teams:user1': { chatId: 'c1', chatSessionId: 's1', lastActiveAt: now - 1000 },
    };
    fsMocks.readFile.mockResolvedValue(JSON.stringify(entries));
    const map = await loadSessionMap('alias');
    expect(map.size).toBe(1);
    expect(map.get('teams:user1')).toMatchObject({ chatId: 'c1' });
  });

  it('filters out expired sessions (beyond TTL)', async () => {
    const now = Date.now();
    const entries = {
      'teams:fresh': { chatId: 'c1', chatSessionId: 's1', lastActiveAt: now - 1000 },
      'teams:stale': { chatId: 'c2', chatSessionId: 's2', lastActiveAt: now - SESSION_TTL - 10000 },
    };
    fsMocks.readFile.mockResolvedValue(JSON.stringify(entries));
    const map = await loadSessionMap('alias');
    expect(map.size).toBe(1);
    expect(map.has('teams:fresh')).toBe(true);
    expect(map.has('teams:stale')).toBe(false);
  });
});

describe('persistSessionMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes sessions to file as JSON', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);

    const map = new Map([
      ['teams:user1', { chatId: 'c1', chatSessionId: 's1', lastActiveAt: 12345 }],
    ]);
    await persistSessionMap('alias', map);

    expect(fsMocks.mkdir).toHaveBeenCalled();
    expect(fsMocks.writeFile).toHaveBeenCalled();
    const writtenContent = fsMocks.writeFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed['teams:user1'].chatId).toBe('c1');
  });

  it('handles write failure gracefully without throwing', async () => {
    fsMocks.mkdir.mockRejectedValue(new Error('Permission denied'));
    const map = new Map();
    await expect(persistSessionMap('alias', map)).resolves.not.toThrow();
  });

  it('writes empty map to file', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    await persistSessionMap('alias', new Map());
    const writtenContent = fsMocks.writeFile.mock.calls[0][1];
    expect(JSON.parse(writtenContent)).toEqual({});
  });
});

describe('pruneSessionMap', () => {
  it('does nothing when map size is within limit', () => {
    const map = new Map<string, any>([
      ['k1', { chatId: 'c1', chatSessionId: 's1', lastActiveAt: 1000 }],
      ['k2', { chatId: 'c2', chatSessionId: 's2', lastActiveAt: 2000 }],
    ]);
    pruneSessionMap(map);
    expect(map.size).toBe(2);
  });

  it('does nothing when map size equals MAX_SESSIONS', () => {
    const map = new Map<string, any>();
    for (let i = 0; i < MAX_SESSIONS; i++) {
      map.set(`k${i}`, { chatId: `c${i}`, chatSessionId: `s${i}`, lastActiveAt: i });
    }
    pruneSessionMap(map);
    expect(map.size).toBe(MAX_SESSIONS);
  });

  it('removes oldest entries when over MAX_SESSIONS', () => {
    const map = new Map<string, any>();
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      map.set(`k${i}`, { chatId: `c${i}`, chatSessionId: `s${i}`, lastActiveAt: i * 1000 });
    }
    pruneSessionMap(map);
    expect(map.size).toBe(MAX_SESSIONS);
    // The 5 oldest (k0..k4) should be removed
    for (let i = 0; i < 5; i++) {
      expect(map.has(`k${i}`)).toBe(false);
    }
    // The newest MAX_SESSIONS entries remain
    expect(map.has(`k${MAX_SESSIONS}`)).toBe(true);
  });
});

describe('createPersistScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedule triggers persist after debounce delay', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    const map = new Map();
    const scheduler = createPersistScheduler('alias', map);

    scheduler.schedule();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + 50);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('calling schedule multiple times only triggers one persist', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    const map = new Map();
    const scheduler = createPersistScheduler('alias', map);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + 50);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents pending persist from firing', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    const map = new Map();
    const scheduler = createPersistScheduler('alias', map);

    scheduler.schedule();
    scheduler.cancel();

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + 50);
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
  });

  it('cancel is a no-op when no timer is pending', () => {
    const map = new Map();
    const scheduler = createPersistScheduler('alias', map);
    expect(() => scheduler.cancel()).not.toThrow();
    expect(() => scheduler.cancel()).not.toThrow();
  });

  it('schedule after cancel starts a fresh timer', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    const map = new Map();
    const scheduler = createPersistScheduler('alias', map);

    scheduler.schedule();
    scheduler.cancel();
    scheduler.schedule();

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + 50);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
  });
});
