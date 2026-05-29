/**
 * Tests for readSchedules — validateArgs, list mode, detail mode, error paths.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../auth/authManager', () => ({
  mainAuthManager: {
    getCurrentAuth: vi.fn(),
  },
}));

vi.mock('../../../scheduler/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scheduler/types')>();
  return {
    ...actual,
    normalizeScheduleMonthFile: (input: any) => actual.normalizeScheduleMonthFile(input),
  };
});

vi.mock('../../chatSession/truncate', () => ({
  truncateMiddle: (text: string, max: number) => text.length <= max ? text : text.slice(0, max),
}));

vi.mock('fs');

// ── import SUT ─────────────────────────────────────────────────────────────

import { executeReadSchedules } from '../readSchedules';
import { mainAuthManager } from '../../../auth/authManager';

const mockFs = vi.mocked(fs);
const mockGetCurrentAuth = vi.mocked(mainAuthManager.getCurrentAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALIAS = 'test-user';
const SCHEDULES_DIR = `/tmp/test/profiles/${ALIAS}/schedules`;

function mockAuth(alias = ALIAS): void {
  mockGetCurrentAuth.mockReturnValue({
    ghcAuth: { alias },
  } as any);
}

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: 'job-1',
    name: 'My Job',
    description: 'Test job description',
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    enabled: true,
    agentId: 'agent-123',
    message: 'Run the analysis',
    status: 'pending',
    lastRunAt: '2026-05-01T09:00:00Z',
    lastFinishedAt: '2026-05-01T09:01:00Z',
    ...overrides,
  };
}

function setupSchedulesDir(monthFiles: Record<string, any> = {}, runtimeState?: any): void {
  mockFs.existsSync.mockImplementation((p) => {
    const s = String(p);
    if (s === SCHEDULES_DIR) return true;
    if (runtimeState && s === path.join(SCHEDULES_DIR, 'runtime-state.json')) return true;
    if (Object.keys(monthFiles).some((name) => s === path.join(SCHEDULES_DIR, name))) return true;
    return false;
  });

  mockFs.readdirSync.mockReturnValue(Object.keys(monthFiles) as any);

  mockFs.readFileSync.mockImplementation((p) => {
    const s = String(p);
    if (runtimeState && s === path.join(SCHEDULES_DIR, 'runtime-state.json')) {
      return JSON.stringify(runtimeState);
    }
    for (const [name, content] of Object.entries(monthFiles)) {
      if (s === path.join(SCHEDULES_DIR, name)) {
        return JSON.stringify(content);
      }
    }
    throw new Error(`ENOENT: ${p}`);
  });
}

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('executeReadSchedules — error paths', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error for invalid mode', async () => {
    mockAuth();
    const result = await executeReadSchedules({ mode: 'invalid' as any });
    expect(result).toMatch(/mode must be/);
  });

  it('returns error when no user alias', async () => {
    mockGetCurrentAuth.mockReturnValue(null as any);
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/No active user alias/);
  });

  it('returns a message when schedules directory does not exist', async () => {
    mockAuth();
    mockFs.existsSync.mockReturnValue(false);
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/No schedules directory/);
  });

  it('returns error for detail mode without scheduleId', async () => {
    mockAuth();
    setupSchedulesDir({});
    const result = await executeReadSchedules({ mode: 'detail' });
    expect(result).toMatch(/scheduleId is required/);
  });

  it('returns error for detail mode with unknown scheduleId', async () => {
    mockAuth();
    setupSchedulesDir({ '2026-05.json': { schedulerJobs: [makeJob()] } });
    const result = await executeReadSchedules({ mode: 'detail', scheduleId: 'nonexistent' });
    expect(result).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// list mode
// ---------------------------------------------------------------------------

describe('executeReadSchedules — list mode', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns empty-jobs message when no month files exist', async () => {
    mockAuth();
    setupSchedulesDir({});
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/No scheduled jobs found/);
  });

  it('returns markdown table with job columns', async () => {
    mockAuth();
    setupSchedulesDir({
      '2026-05.json': { schedulerJobs: [makeJob()] },
    });
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/## Schedules/);
    expect(result).toMatch(/My Job/);
    expect(result).toMatch(/cron/);
    expect(result).toMatch(/0 9 \* \* \*/);
  });

  it('includes runtime-state information when available', async () => {
    mockAuth();
    const runtimeState = {
      isActive: true,
      lastActivatedAt: '2026-05-01T08:00:00Z',
    };
    setupSchedulesDir(
      { '2026-05.json': { schedulerJobs: [makeJob()] } },
      runtimeState,
    );
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/isActive: true/);
    expect(result).toMatch(/lastActivatedAt/);
  });

  it('includes pending cold-start catch-up count', async () => {
    mockAuth();
    const runtimeState = {
      isActive: false,
      pendingColdStartCatchUps: {
        'job-1': { occurrenceAt: '2026-05-01T09:00:00Z', recordedAt: '2026-05-01T09:05:00Z' },
      },
    };
    setupSchedulesDir(
      { '2026-05.json': { schedulerJobs: [makeJob()] } },
      runtimeState,
    );
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/pendingColdStartCatchUps: 1/);
  });

  it('loads jobs from multiple month files', async () => {
    mockAuth();
    setupSchedulesDir({
      '2026-04.json': { schedulerJobs: [makeJob({ id: 'j1', name: 'April Job' })] },
      '2026-05.json': { schedulerJobs: [makeJob({ id: 'j2', name: 'May Job' })] },
    });
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/April Job/);
    expect(result).toMatch(/May Job/);
  });

  it('handles malformed month files gracefully', async () => {
    mockAuth();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['2026-05.json'] as any);
    mockFs.readFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('2026-05.json')) return 'not valid json {{';
      return '{}';
    });
    const result = await executeReadSchedules({ mode: 'list' });
    expect(result).toMatch(/No scheduled jobs found|totalJobs: 0/);
  });
});

// ---------------------------------------------------------------------------
// detail mode
// ---------------------------------------------------------------------------

describe('executeReadSchedules — detail mode', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns detail for a known job id', async () => {
    mockAuth();
    setupSchedulesDir({
      '2026-05.json': { schedulerJobs: [makeJob()] },
    });
    const result = await executeReadSchedules({ mode: 'detail', scheduleId: 'job-1' });
    expect(result).toMatch(/## Schedule Detail/);
    expect(result).toMatch(/My Job/);
    expect(result).toMatch(/Run the analysis/);
    expect(result).toMatch(/Test job description/);
  });

  it('includes cold-start catch-up section when present', async () => {
    mockAuth();
    const runtimeState = {
      pendingColdStartCatchUps: {
        'job-1': {
          occurrenceAt: '2026-05-01T09:00:00Z',
          recordedAt: '2026-05-01T09:05:00Z',
        },
      },
    };
    setupSchedulesDir(
      { '2026-05.json': { schedulerJobs: [makeJob()] } },
      runtimeState,
    );
    const result = await executeReadSchedules({ mode: 'detail', scheduleId: 'job-1' });
    expect(result).toMatch(/Cold-Start Catch-Up/);
    expect(result).toMatch(/occurrenceAt/);
  });

  it('does not include cold-start section when no catch-up exists', async () => {
    mockAuth();
    setupSchedulesDir({
      '2026-05.json': { schedulerJobs: [makeJob()] },
    });
    const result = await executeReadSchedules({ mode: 'detail', scheduleId: 'job-1' });
    expect(result).not.toMatch(/Cold-Start Catch-Up/);
  });

  it('includes runAt for once-type jobs', async () => {
    mockAuth();
    setupSchedulesDir({
      '2026-05.json': {
        schedulerJobs: [makeJob({ scheduleType: 'once', runAt: '2026-06-01T10:00:00Z', cronExpression: undefined })],
      },
    });
    const result = await executeReadSchedules({ mode: 'detail', scheduleId: 'job-1' });
    expect(result).toMatch(/runAt/);
    expect(result).toMatch(/2026-06-01T10:00:00Z/);
  });
});
