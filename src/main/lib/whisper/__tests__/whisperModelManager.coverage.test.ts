// @ts-nocheck
/**
 * whisperModelManager.ts coverage tests
 */

import * as fs from 'fs';
import * as path from 'path';

// ── hoisted mock vars ─────────────────────────────────────────────────────────

const mockGetPath = vi.hoisted(() => vi.fn(() => '/mock/userData'));
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockRenameSync = vi.hoisted(() => vi.fn());
const mockCreateWriteStream = vi.hoisted(() => vi.fn());

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: (...args: any[]) => mockGetPath(...args),
  },
  BrowserWindow: {},
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    statSync: (...args: any[]) => mockStatSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
    renameSync: (...args: any[]) => mockRenameSync(...args),
    createWriteStream: (...args: any[]) => mockCreateWriteStream(...args),
  };
});

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ── tests ─────────────────────────────────────────────────────────────────────

// We need to reset the singleton between tests — import after mocks
let manager: typeof import('../whisperModelManager').default;

beforeEach(async () => {
  vi.resetModules();
  // Default: models dir exists so ensureModelsDir is a no-op
  mockExistsSync.mockReturnValue(true);
  const mod = await import('../whisperModelManager');
  manager = mod.default;
});

describe('WhisperModelManager – basic ops', () => {
  it('returns model path for known size', () => {
    const p = manager.getModelPath('tiny');
    expect(p).toContain('ggml-tiny.bin');
    expect(p).toContain('whisper-models');
  });

  it('isModelDownloaded returns true when file exists', () => {
    mockExistsSync.mockReturnValue(true);
    expect(manager.isModelDownloaded('base')).toBe(true);
  });

  it('isModelDownloaded returns false when file absent', () => {
    mockExistsSync.mockReturnValue(false);
    expect(manager.isModelDownloaded('base')).toBe(false);
  });

  it('getModelStatus returns downloaded=true with size when file exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 12345 });
    const status = manager.getModelStatus('small');
    expect(status.downloaded).toBe(true);
    expect(status.actualSize).toBe(12345);
    expect(status.path).toBeTruthy();
  });

  it('getModelStatus returns downloaded=false when absent', () => {
    mockExistsSync.mockReturnValue(false);
    const status = manager.getModelStatus('tiny');
    expect(status.downloaded).toBe(false);
    expect(status.path).toBeUndefined();
  });

  it('getModelStatus handles statSync error gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockImplementation(() => { throw new Error('stat fail'); });
    const status = manager.getModelStatus('medium');
    expect(status.downloaded).toBe(true);
    expect(status.actualSize).toBeUndefined();
  });

  it('getAllModelStatus returns 5 statuses', () => {
    mockExistsSync.mockReturnValue(false);
    const statuses = manager.getAllModelStatus();
    expect(statuses).toHaveLength(5);
  });

  it('getModelInfo returns correct info', () => {
    const info = manager.getModelInfo('turbo');
    expect(info.size).toBe('turbo');
    expect(info.fileName).toMatch(/\.bin$/);
  });

  it('getAllModelInfo returns 5 items', () => {
    expect(manager.getAllModelInfo()).toHaveLength(5);
  });
});

describe('WhisperModelManager – download/cancel/delete', () => {
  it('isDownloading returns false initially', () => {
    expect(manager.isDownloading()).toBe(false);
  });

  it('getActiveDownloads returns empty array initially', () => {
    expect(manager.getActiveDownloads()).toEqual([]);
  });

  it('cancelDownload returns false when no active download', () => {
    expect(manager.cancelDownload('tiny')).toBe(false);
  });

  it('downloadModel returns early if already downloaded', async () => {
    mockExistsSync.mockReturnValue(true);
    await expect(manager.downloadModel('tiny')).resolves.toBeUndefined();
  });

  // Skipped: vi.spyOn on ESM namespace not supported in vitest
  // it('downloadModel throws if already downloading the same size')

  it('deleteModel returns false when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(manager.deleteModel('tiny')).toBe(false);
  });

  it('deleteModel deletes file and returns true', () => {
    mockExistsSync.mockReturnValue(true);
    mockUnlinkSync.mockReturnValue(undefined);
    expect(manager.deleteModel('tiny')).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('deleteModel rethrows on unlink error', () => {
    mockExistsSync.mockReturnValue(true);
    mockUnlinkSync.mockImplementation(() => { throw new Error('permission denied'); });
    expect(() => manager.deleteModel('tiny')).toThrow('permission denied');
  });
});

describe('WhisperModelManager – ensureModelsDir on first boot', () => {
  it('creates models dir when absent', async () => {
    vi.resetModules();
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockReturnValue(undefined);
    await import('../whisperModelManager');
    expect(mockMkdirSync).toHaveBeenCalled();
  });
});
