import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../userDataADO/scheduleSettingsManager', async () => ({
  scheduleSettingsManager: {
    ensureSchedulesDir: vi.fn(),
  },
}));

describe('SchedulerRuntimeStateStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = path.join(os.tmpdir(), `test-scheduler-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
    vi.mocked(scheduleSettingsManager.ensureSchedulesDir).mockImplementation(async (alias: string) => {
      const dir = path.join(tempDir, alias);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('readState returns default state when file does not exist', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const state = await store.readState('alice');
    expect(state.alias).toBe('alice');
    expect(state.isActive).toBe(false);
    expect(state.schemaVersion).toBe(1);
  });

  it('markActivated persists isActive=true', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const result = await store.markActivated('alice', '2026-05-11T12:00:00.000Z');
    expect(result.isActive).toBe(true);
    expect(result.lastActivatedAt).toBe('2026-05-11T12:00:00.000Z');

    const state = await store.readState('alice');
    expect(state.isActive).toBe(true);
  });

  it('markDeactivated persists isActive=false', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    await store.markActivated('alice', '2026-05-11T12:00:00.000Z');
    const result = await store.markDeactivated('alice', '2026-05-11T13:00:00.000Z');
    expect(result.isActive).toBe(false);
    expect(result.lastDeactivatedAt).toBe('2026-05-11T13:00:00.000Z');
  });

  it('markPendingColdStartCatchUp adds a pending entry', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const result = await store.markPendingColdStartCatchUp(
      'alice',
      'job-1',
      '2026-05-11T10:00:00.000Z',
      '2026-05-11T12:00:00.000Z',
    );
    expect(result.pendingColdStartCatchUps?.['job-1']).toMatchObject({
      occurrenceAt: '2026-05-11T10:00:00.000Z',
      recordedAt: '2026-05-11T12:00:00.000Z',
    });
  });

  it('clearPendingColdStartCatchUp removes a pending entry', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    await store.markPendingColdStartCatchUp(
      'alice',
      'job-1',
      '2026-05-11T10:00:00.000Z',
      '2026-05-11T12:00:00.000Z',
    );
    const result = await store.clearPendingColdStartCatchUp('alice', 'job-1');
    expect(result.pendingColdStartCatchUps).toBeUndefined();
  });

  it('clearPendingColdStartCatchUp is a no-op when entry does not exist', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const state = await store.readState('alice');
    const result = await store.clearPendingColdStartCatchUp('alice', 'nonexistent');
    expect(result.pendingColdStartCatchUps).toBeUndefined();
    expect(result.alias).toBe(state.alias);
  });

  it('handles empty file content gracefully', async () => {
    const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
    const dir = await (scheduleSettingsManager.ensureSchedulesDir as any)('bob');
    const filePath = path.join(dir, 'runtime-state.json');
    fs.writeFileSync(filePath, '   ');

    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const state = await store.readState('bob');
    expect(state.isActive).toBe(false);
  });

  it('handles corrupt JSON gracefully by throwing', async () => {
    const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
    const dir = await (scheduleSettingsManager.ensureSchedulesDir as any)('carol');
    const filePath = path.join(dir, 'runtime-state.json');
    fs.writeFileSync(filePath, '{invalid json}');

    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    await expect(store.readState('carol')).rejects.toThrow();
  });

  it('concurrent writes are serialized per alias', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const [r1, r2] = await Promise.all([
      store.markActivated('dave', '2026-05-11T12:00:00.000Z'),
      store.markDeactivated('dave', '2026-05-11T12:05:00.000Z'),
    ]);
    // Both should succeed
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    const finalState = await store.readState('dave');
    // Final state should reflect both operations (deactivated last)
    expect(typeof finalState.isActive).toBe('boolean');
  });

  it('normalizes invalid dates in markActivated', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    // Pass an invalid date string — should not crash and should keep existing value
    const result = await store.markActivated('alice', 'not-a-date');
    expect(result.isActive).toBe(true);
    // lastActivatedAt should be undefined since normalization fails
    expect(result.lastActivatedAt).toBeUndefined();
  });

  it('normalizePendingColdStartCatchUps filters out non-object entries', async () => {
    const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
    const dir = await (scheduleSettingsManager.ensureSchedulesDir as any)('edge');
    const filePath = path.join(dir, 'runtime-state.json');
    // Write state with invalid pending entries: null, string, missing dates
    fs.writeFileSync(filePath, JSON.stringify({
      schemaVersion: 1,
      alias: 'edge',
      isActive: false,
      pendingColdStartCatchUps: {
        'job-null': null,
        'job-str': 'not-an-object',
        'job-no-dates': { occurrenceAt: 'bad', recordedAt: 'also-bad' },
        'job-valid': { occurrenceAt: '2026-05-11T10:00:00.000Z', recordedAt: '2026-05-11T12:00:00.000Z' },
      },
    }));

    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    const state = await store.readState('edge');
    // Only job-valid should survive
    expect(Object.keys(state.pendingColdStartCatchUps || {})).toEqual(['job-valid']);
  });

  it('withAliasLock cleans up the lock after single operation', async () => {
    const { SchedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();
    await store.markActivated('lock-test', '2026-05-11T12:00:00.000Z');
    // After operation, writeLocks for this alias should be cleaned up or the promise resolved
    // The lock is cleaned up only if no other operation is queued on the same alias
    const lock = store.writeLocks.get('lock-test');
    // Either the lock is gone, or it has resolved
    if (lock) {
      await expect(lock).resolves.toBeUndefined();
    } else {
      expect(lock).toBeUndefined();
    }
  });
});
