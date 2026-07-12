import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

// We need real fs operations for atomic write tests
// Override pathUtils to use temp directory
let tmpDir: string;

vi.mock('../pathUtils', () => ({
  getProfileDirectoryPath: vi.fn((alias: string) => path.join(tmpDir, alias)),
}));

import { ScheduleSettingsManager } from '../scheduleSettingsManager';
import type { SchedulerJob } from '../../scheduler/types';

// Valid job ID format: sched_YYYYMMDDHHMMSS_<deviceid>_<random>
function makeJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    id: 'sched_20260101120000_device_abc12345',
    name: 'Test Job',
    description: 'desc',
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    enabled: true,
    chat_id: 'chat_001',
    message: 'run',
    status: 'pending',
    ...overrides,
  } as SchedulerJob;
}

describe('ScheduleSettingsManager', () => {
  let manager: ScheduleSettingsManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedmgr-test-'));
    // Reset singleton so the path mock takes effect
    (ScheduleSettingsManager as any).instance = undefined;
    manager = ScheduleSettingsManager.getInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('returns singleton', () => {
      const a = ScheduleSettingsManager.getInstance();
      const b = ScheduleSettingsManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('ensureSchedulesDir', () => {
    it('creates and returns schedules directory', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      expect(dir).toContain('schedules');
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('listScheduleMonths', () => {
    it('returns empty array when no month files exist', async () => {
      const result = await manager.listScheduleMonths('alice');
      expect(result).toEqual([]);
    });

    it('returns sorted months in descending order', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      fs.writeFileSync(path.join(dir, '202601.json'), JSON.stringify({ schedulerJobs: [] }));
      fs.writeFileSync(path.join(dir, '202603.json'), JSON.stringify({ schedulerJobs: [] }));
      fs.writeFileSync(path.join(dir, '202602.json'), JSON.stringify({ schedulerJobs: [] }));

      const result = await manager.listScheduleMonths('alice');
      expect(result).toEqual(['202603', '202602', '202601']);
    });
  });

  describe('readScheduleMonth', () => {
    it('returns empty schedulerJobs when file does not exist', async () => {
      const result = await manager.readScheduleMonth('alice', '202601');
      expect(result.schedulerJobs).toEqual([]);
    });

    it('returns empty schedulerJobs when file is empty', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      fs.writeFileSync(path.join(dir, '202601.json'), '');
      const result = await manager.readScheduleMonth('alice', '202601');
      expect(result.schedulerJobs).toEqual([]);
    });

    it('reads and normalizes jobs from file', async () => {
      const job = makeJob();
      const dir = await manager.ensureSchedulesDir('alice');
      fs.writeFileSync(path.join(dir, '202601.json'), JSON.stringify({ schedulerJobs: [job] }));

      const result = await manager.readScheduleMonth('alice', '202601');
      expect(result.schedulerJobs).toHaveLength(1);
      expect(result.schedulerJobs[0].id).toBe(job.id);
    });

    it('throws on invalid month key', async () => {
      await expect(manager.readScheduleMonth('alice', 'BADKEY')).rejects.toThrow('Invalid schedule month key');
    });

    it('rewrites legacy agentId jobs to chat_id on disk', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      const file = path.join(dir, '202601.json');
      const legacy = makeJob() as unknown as Record<string, unknown>;
      delete legacy.chat_id;
      legacy.agentId = 'chat-legacy-1';
      fs.writeFileSync(file, JSON.stringify({ schedulerJobs: [legacy] }));

      const result = await manager.readScheduleMonth('alice', '202601');
      expect(result.schedulerJobs[0].chat_id).toBe('chat-legacy-1');

      const onDisk = fs.readFileSync(file, 'utf-8');
      expect(onDisk).not.toContain('agentId');
      expect(onDisk).toContain('chat_id');
    });
  });

  describe('writeScheduleMonth', () => {
    it('writes schedule month to file', async () => {
      const job = makeJob();
      await manager.writeScheduleMonth('alice', '202601', { schedulerJobs: [job] });

      const dir = await manager.ensureSchedulesDir('alice');
      const filePath = path.join(dir, '202601.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.schedulerJobs).toHaveLength(1);
      expect(content.schedulerJobs[0].id).toBe(job.id);
    });
  });

  describe('upsertScheduleJob', () => {
    it('inserts new job', async () => {
      const job = makeJob();
      const monthKey = await manager.upsertScheduleJob('alice', job);
      expect(monthKey).toBe('202601');

      const monthFile = await manager.readScheduleMonth('alice', '202601');
      expect(monthFile.schedulerJobs).toHaveLength(1);
    });

    it('updates existing job', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);

      const updated = { ...job, status: 'completed' as const };
      await manager.upsertScheduleJob('alice', updated);

      const monthFile = await manager.readScheduleMonth('alice', '202601');
      expect(monthFile.schedulerJobs).toHaveLength(1);
      expect(monthFile.schedulerJobs[0].status).toBe('completed');
    });

    it('throws on invalid job id', async () => {
      const job = makeJob({ id: 'invalid_id' });
      await expect(manager.upsertScheduleJob('alice', job)).rejects.toThrow('Invalid schedule job id');
    });

    it('resolves month key for once-type job from runAt', async () => {
      const job = makeJob({
        id: 'sched_20260515090000_device_abc12345',
        scheduleType: 'once',
        runAt: '2026-05-15T09:00:00Z',
        cronExpression: undefined,
      });
      const monthKey = await manager.upsertScheduleJob('alice', job);
      expect(monthKey).toBe('202605');
    });

    it('throws for once-type job missing runAt', async () => {
      const job = makeJob({
        id: 'sched_20260515090001_device_abc12345',
        scheduleType: 'once',
        runAt: undefined,
        cronExpression: undefined,
      });
      await expect(manager.upsertScheduleJob('alice', job)).rejects.toThrow();
    });
  });

  describe('deleteScheduleJob', () => {
    it('returns false when job not found', async () => {
      const result = await manager.deleteScheduleJob('alice', '202601', 'nonexistent');
      expect(result).toBe(false);
    });

    it('deletes file when last job is removed', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const result = await manager.deleteScheduleJob('alice', '202601', job.id);
      expect(result).toBe(true);

      const dir = await manager.ensureSchedulesDir('alice');
      expect(fs.existsSync(path.join(dir, '202601.json'))).toBe(false);
    });

    it('removes job but keeps file when other jobs remain', async () => {
      const job1 = makeJob({ id: 'sched_20260101120000_device_aaa11111' });
      const job2 = makeJob({ id: 'sched_20260101120001_device_bbb22222' });
      await manager.upsertScheduleJob('alice', job1);
      await manager.upsertScheduleJob('alice', job2);

      const result = await manager.deleteScheduleJob('alice', '202601', job1.id);
      expect(result).toBe(true);

      const monthFile = await manager.readScheduleMonth('alice', '202601');
      expect(monthFile.schedulerJobs).toHaveLength(1);
      expect(monthFile.schedulerJobs[0].id).toBe(job2.id);
    });
  });

  describe('findJobLocation', () => {
    it('returns null when job not found', async () => {
      const result = await manager.findJobLocation('alice', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns location when job found', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const result = await manager.findJobLocation('alice', job.id);
      expect(result).not.toBeNull();
      expect(result!.monthKey).toBe('202601');
      expect(result!.job.id).toBe(job.id);
    });
  });

  describe('getAllJobs', () => {
    it('returns empty array when no jobs', async () => {
      expect(await manager.getAllJobs('alice')).toEqual([]);
    });

    it('returns all jobs sorted by id descending', async () => {
      const job1 = makeJob({ id: 'sched_20260101120000_device_abc12345' });
      const job2 = makeJob({ id: 'sched_20260201120000_device_abc12345' });
      await manager.upsertScheduleJob('alice', job1);
      await manager.upsertScheduleJob('alice', job2);

      const result = await manager.getAllJobs('alice');
      expect(result).toHaveLength(2);
      expect(result[0].id > result[1].id).toBe(true);
    });
  });

  describe('delete/find/getAll/list', () => {
    it('deletes the only job and unlinks the month file', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const dir = await manager.ensureSchedulesDir('alice');
      expect(await manager.deleteScheduleJob('alice', '202601', job.id)).toBe(true);
      expect(fs.existsSync(path.join(dir, '202601.json'))).toBe(false);
    });

    it('returns false deleting a missing job', async () => {
      await manager.upsertScheduleJob('alice', makeJob());
      expect(await manager.deleteScheduleJob('alice', '202601', 'nope')).toBe(false);
    });

    it('rewrites file when deleting one of several jobs', async () => {
      await manager.upsertScheduleJob('alice', makeJob());
      await manager.upsertScheduleJob('alice', makeJob({ id: 'sched_20260101130000_device_def67890' }));
      expect(await manager.deleteScheduleJob('alice', '202601', 'sched_20260101130000_device_def67890')).toBe(true);
      const after = await manager.readScheduleMonth('alice', '202601');
      expect(after.schedulerJobs).toHaveLength(1);
    });

    it('finds a job location and returns null when absent', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const loc = await manager.findJobLocation('alice', job.id);
      expect(loc?.monthKey).toBe('202601');
      expect(await manager.findJobLocation('alice', 'absent')).toBeNull();
    });

    it('aggregates all jobs across months', async () => {
      await manager.upsertScheduleJob('alice', makeJob());
      await manager.upsertScheduleJob('alice', makeJob({ id: 'sched_20260201120000_device_aaa11111', cronExpression: '0 9 * * *' }));
      const all = await manager.getAllJobs('alice');
      expect(all.length).toBe(2);
    });

    it('listScheduleMonths returns [] when dir is missing', async () => {
      expect(await manager.listScheduleMonths('ghost')).toEqual([]);
    });
  });

  describe('error paths', () => {
    it('rethrows on malformed json', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      fs.writeFileSync(path.join(dir, '202601.json'), '{not json');
      await expect(manager.readScheduleMonth('alice', '202601')).rejects.toBeTruthy();
    });

    it('cleans up temp file and rethrows when rename fails', async () => {
      const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('rename fail'));
      await expect(manager.upsertScheduleJob('alice', makeJob())).rejects.toThrow('rename fail');
      spy.mockRestore();
    });

    it('rethrows when unlinking empty month file fails', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const spy = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('unlink fail'));
      await expect(manager.deleteScheduleJob('alice', '202601', job.id)).rejects.toThrow('unlink fail');
      spy.mockRestore();
    });
  });

  describe('non-Error rejection arms', () => {
    it('handles string read errors', async () => {
      const dir = await manager.ensureSchedulesDir('alice');
      fs.writeFileSync(path.join(dir, '202601.json'), '{"schedulerJobs":[]}');
      const spy = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce('str-read');
      await expect(manager.readScheduleMonth('alice', '202601')).rejects.toBe('str-read');
      spy.mockRestore();
    });

    it('handles string readdir errors returning []', async () => {
      const spy = vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce('str-dir');
      expect(await manager.listScheduleMonths('alice')).toEqual([]);
      spy.mockRestore();
    });

    it('handles string unlink errors when deleting last job', async () => {
      const job = makeJob();
      await manager.upsertScheduleJob('alice', job);
      const spy = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce('str-unlink');
      await expect(manager.deleteScheduleJob('alice', '202601', job.id)).rejects.toBe('str-unlink');
      spy.mockRestore();
    });

    it('rethrows when temp writeFile fails before rename', async () => {
      const spy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('write fail'));
      await expect(manager.upsertScheduleJob('alice', makeJob())).rejects.toThrow('write fail');
      spy.mockRestore();
    });
  });
});
