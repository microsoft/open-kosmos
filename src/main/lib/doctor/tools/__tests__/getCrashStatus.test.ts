import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetStatus } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
}));

vi.mock('../../../crash/CrashCaptureManager', () => ({
  crashCaptureManager: {
    getStatus: mockGetStatus,
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { executeGetCrashStatus, getCrashStatusToolDef } from '../getCrashStatus';
import * as fs from 'fs';
import * as path from 'path';

describe('getCrashStatusToolDef', () => {
  it('has correct name', () => {
    expect(getCrashStatusToolDef.function.name).toBe('get_crash_status');
  });
});

describe('executeGetCrashStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hasRecoveredCrash=false and no artifacts message when dirs do not exist', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.hasRecoveredCrash).toBe(false);
    expect(result.recentBundles).toEqual([]);
    expect(result.minidumps).toEqual([]);
    expect(result.summary).toContain('No crash artifacts');
  });

  it('includes recoveredCrash summary when present', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: true,
      recoveredCrash: {
        previousSessionId: 'sess-123',
        startedAt: '2026-05-17T10:00:00Z',
        appVersion: '1.0.0',
        bundlePath: '/crash/root/bundle-abc/manifest.json',
      },
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.hasRecoveredCrash).toBe(true);
    expect(result.recoveredCrash.previousSessionId).toBe('sess-123');
    expect(result.recoveredCrash.bundleName).toBe('manifest.json');
  });

  it('lists recent bundle directories', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return p === '/crash/root' || p === '/crash/root/bundle-1';
    });
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (dir === '/crash/root') {
        return [
          { name: 'bundle-1', isDirectory: () => true, isFile: () => false } as any,
        ];
      }
      return [];
    });
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      mtime: new Date('2026-05-17T10:00:00Z'),
      size: 100,
    } as any);

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.recentBundles).toHaveLength(1);
    expect(result.recentBundles[0].name).toBe('bundle-1');
  });

  it('reads manifest.json from bundle', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });

    const existingPaths = new Set([
      '/crash/root',
      '/crash/root/bundle-1',
      '/crash/root/bundle-1/manifest.json',
    ]);
    vi.mocked(fs.existsSync).mockImplementation((p: any) => existingPaths.has(p));
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (dir === '/crash/root') {
        return [{ name: 'bundle-1', isDirectory: () => true, isFile: () => false } as any];
      }
      return [
        { name: 'manifest.json', isDirectory: () => false, isFile: () => true } as any,
      ];
    });
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      mtime: new Date('2026-05-17T10:00:00Z'),
      size: 500,
    } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ eventType: 'main-uncaught-exception', appVersion: '1.2.0', capturedAt: '2026-05-17T10:00:00Z' })
    );

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.recentBundles[0].eventType).toBe('main-uncaught-exception');
    expect(result.recentBundles[0].appVersion).toBe('1.2.0');
  });

  it('reads previousSessionId from recovered-crash.json', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });

    const existingPaths = new Set([
      '/crash/root',
      '/crash/root/bundle-1',
      '/crash/root/bundle-1/recovered-crash.json',
    ]);
    vi.mocked(fs.existsSync).mockImplementation((p: any) => existingPaths.has(p));
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (dir === '/crash/root') {
        return [{ name: 'bundle-1', isDirectory: () => true, isFile: () => false } as any];
      }
      return [
        { name: 'recovered-crash.json', isDirectory: () => false, isFile: () => true } as any,
      ];
    });
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      mtime: new Date('2026-05-17T10:00:00Z'),
      size: 200,
    } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ previousSessionId: 'sess-prev' })
    );

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.recentBundles[0].previousSessionId).toBe('sess-prev');
  });

  it('detects minidump files', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });

    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === '/crash/dumps');
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (dir === '/crash/dumps') {
        return [
          { name: 'crash.dmp', isDirectory: () => false, isFile: () => true } as any,
        ];
      }
      return [];
    });
    vi.mocked(fs.statSync).mockReturnValue({
      size: 1024,
      mtime: new Date('2026-05-17T09:00:00Z'),
    } as any);

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.minidumps).toHaveLength(1);
    expect(result.minidumps[0].name).toBe('crash.dmp');
    expect(result.minidumpsNote).toBeDefined();
  });

  it('searches subdirectories for .dmp files', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '',
      crashDumpsDir: '/crash/dumps',
    });

    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      p === '/crash/dumps' || p === '/crash/dumps/completed'
    );
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (dir === '/crash/dumps') {
        return [{ name: 'completed', isDirectory: () => true, isFile: () => false } as any];
      }
      if (dir === '/crash/dumps/completed') {
        return [{ name: 'app.dmp', isDirectory: () => false, isFile: () => true } as any];
      }
      return [];
    });
    vi.mocked(fs.statSync).mockReturnValue({
      size: 2048,
      mtime: new Date('2026-05-17T09:00:00Z'),
    } as any);

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.minidumps).toHaveLength(1);
    expect(result.minidumps[0].name).toBe('app.dmp');
  });

  it('handles readdirSync failure gracefully', async () => {
    mockGetStatus.mockReturnValue({
      hasRecoveredCrash: false,
      recoveredCrash: null,
      crashRootDir: '/crash/root',
      crashDumpsDir: '/crash/dumps',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('EPERM'); });

    const result = JSON.parse(await executeGetCrashStatus());
    expect(result.recentBundles).toEqual([]);
    expect(result.minidumps).toEqual([]);
  });
});
