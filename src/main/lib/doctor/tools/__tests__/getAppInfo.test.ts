import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron before any imports
vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'OpenKosmos'),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn((name: string) => `/mock/userData`),
  },
}));

vi.mock('../../../unifiedLogger/FileOperations', () => ({
  getCurrentLogFileName: vi.fn(() => 'kosmos-dev-2026-05-17-10-00-00.log'),
  isDevelopmentLogEnvironment: vi.fn(() => true),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statSync: vi.fn(),
  };
});

import { executeGetAppInfo } from '../getAppInfo';
import * as fs from 'fs';

describe('executeGetAppInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns JSON with app name and version', async () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('not found');
    });
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.app.name).toBe('OpenKosmos');
    expect(result.app.version).toBe('1.0.0');
  });

  it('includes platform, arch, electron, node, chrome', async () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error(); });
    // Ensure process.versions has electron/chrome for this test
    (process.versions as any).electron = '35.0.0';
    (process.versions as any).chrome = '130.0.0';
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.platform).toBeDefined();
    expect(result.arch).toBeDefined();
    expect(result.electron).toBe('35.0.0');
    expect(result.node).toBeDefined();
    expect(result.chrome).toBe('130.0.0');
    delete (process.versions as any).electron;
    delete (process.versions as any).chrome;
  });

  it('includes memory and uptime', async () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error(); });
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.memory.rss).toMatch(/MB/);
    expect(result.memory.heapUsed).toMatch(/MB/);
    expect(result.memory.heapTotal).toMatch(/MB/);
    expect(result.uptime).toMatch(/seconds/);
  });

  it('includes logs section', async () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error(); });
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.logs.dir).toContain('logs');
    expect(result.logs.currentFile).toBe('kosmos-dev-2026-05-17-10-00-00.log');
    expect(result.logs.mode).toBe('dev-per-launch');
  });

  it('fills currentLogStartedAt when stat succeeds with birthtime', async () => {
    const mockStat = {
      birthtimeMs: 1000,
      birthtime: new Date('2026-05-17T10:00:00Z'),
      mtime: new Date('2026-05-17T11:00:00Z'),
      size: 2048,
    };
    vi.mocked(fs.statSync).mockReturnValue(mockStat as any);
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.logs.currentFileStartedAt).toBe('2026-05-17T10:00:00.000Z');
    expect(result.logs.currentFileSizeBytes).toBe(2048);
  });

  it('falls back to mtime when birthtimeMs is 0', async () => {
    const mockStat = {
      birthtimeMs: 0,
      birthtime: new Date('2026-05-17T10:00:00Z'),
      mtime: new Date('2026-05-17T11:00:00Z'),
      size: 512,
    };
    vi.mocked(fs.statSync).mockReturnValue(mockStat as any);
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.logs.currentFileStartedAt).toBe('2026-05-17T11:00:00.000Z');
  });

  it('leaves currentLogStartedAt null when stat throws', async () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT'); });
    const result = JSON.parse(await executeGetAppInfo());
    expect(result.logs.currentFileStartedAt).toBeNull();
    expect(result.logs.currentFileSizeBytes).toBeNull();
  });
});
