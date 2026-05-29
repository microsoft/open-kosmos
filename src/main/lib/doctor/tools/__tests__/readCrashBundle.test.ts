import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetStatus } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
}));

vi.mock('../../../crash/CrashCaptureManager', () => ({
  crashCaptureManager: { getStatus: mockGetStatus },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import { executeReadCrashBundle, readCrashBundleToolDef } from '../readCrashBundle';
import * as fs from 'fs';
import * as path from 'path';

function mockBundle(bundleName: string, files: Record<string, unknown>) {
  const crashRootDir = '/crash/root';
  const bundleDir = path.join(crashRootDir, bundleName);

  vi.mocked(fs.existsSync).mockImplementation((p: any) => {
    if (p === bundleDir) return true;
    return Object.keys(files).some((f) => path.join(bundleDir, f) === p);
  });
  vi.mocked(fs.statSync).mockImplementation((p: any) => {
    if (p === bundleDir) return { isDirectory: () => true } as any;
    return { isDirectory: () => false } as any;
  });
  vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
    const rel = path.basename(p as string);
    if (files[rel] !== undefined) return JSON.stringify(files[rel]);
    throw new Error('not found');
  });

  return crashRootDir;
}

describe('readCrashBundleToolDef', () => {
  it('has correct name', () => {
    expect(readCrashBundleToolDef.function.name).toBe('read_crash_bundle');
  });
});

describe('executeReadCrashBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockReturnValue({ crashRootDir: '/crash/root' });
  });

  it('returns error when bundleName is missing', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: '' }));
    expect(r.error).toContain('required');
  });

  it('returns error when bundleName is non-string', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: null as any }));
    expect(r.error).toContain('required');
  });

  it('returns error when bundleName contains path separator /', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: 'a/b' }));
    expect(r.error).toContain('Invalid bundleName');
  });

  it('returns error when bundleName contains backslash', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: 'a\\b' }));
    expect(r.error).toContain('Invalid bundleName');
  });

  it('returns error when bundleName is "."', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: '.' }));
    expect(r.error).toContain('Invalid bundleName');
  });

  it('returns error when bundleName is ".."', async () => {
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: '..' }));
    expect(r.error).toContain('Invalid bundleName');
  });

  it('returns error when crashRootDir is not set', async () => {
    mockGetStatus.mockReturnValue({ crashRootDir: '' });
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: 'bundle-1' }));
    expect(r.error).toContain('not initialized');
  });

  it('returns error when bundle directory does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: 'bundle-1' }));
    expect(r.error).toContain('not found');
  });

  it('returns error when bundle path is not a directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);
    const r = JSON.parse(await executeReadCrashBundle({ bundleName: 'bundle-1' }));
    expect(r.error).toContain('not found');
  });

  it('returns markdown with manifest section', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'main-uncaught-exception', appVersion: '1.0.0', capturedAt: '2026-05-17T10:00:00Z' },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('# Crash Bundle');
    expect(result).toContain('Manifest');
    expect(result).toContain('main-uncaught-exception');
  });

  it('includes recovered-crash.json content', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'recovered-unclean-exit' },
      'recovered-crash.json': { previousSessionId: 'sess-old', startedAt: '2026-01-01T00:00:00Z' },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('Recovered Crash');
    expect(result).toContain('sess-old');
  });

  it('formats main-uncaught-exception event payload', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'main-uncaught-exception' },
      'event.json': {
        origin: 'unhandledRejection',
        error: { name: 'TypeError', message: 'Cannot read property', stack: 'TypeError: ...\n    at fn' },
      },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('TypeError');
    expect(result).toContain('Cannot read property');
  });

  it('formats renderer-error event payload', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'renderer-error' },
      'event.json': {
        report: {
          kind: 'JavaScriptError',
          name: 'ReferenceError',
          message: 'foo is not defined',
          stack: 'ReferenceError: foo is not defined\n    at line 1',
          url: 'file:///app.html',
          source: 'renderer',
        },
      },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('ReferenceError');
    expect(result).toContain('renderer-error');
  });

  it('formats generic event payload (renderer-process-gone)', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'renderer-process-gone' },
      'event.json': { reason: 'crashed', exitCode: 1 },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('renderer-process-gone');
  });

  it('includes system snapshot without versions.*', async () => {
    mockBundle('bundle-1', {
      'manifest.json': {},
      'system.json': { platform: 'darwin', versions: { node: '20' }, memory: { total: 16 } },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('System Snapshot');
    expect(result).toContain('platform');
    expect(result).not.toContain('"versions"');
  });

  it('includes breadcrumbs table', async () => {
    const breadcrumbs = [
      { timestamp: '2026-05-17T10:00:00.000Z', category: 'navigation', message: 'page load', metadata: { url: '/home' } },
      { timestamp: '2026-05-17T10:01:00.000Z', category: 'user', message: 'click', metadata: null },
    ];
    mockBundle('bundle-1', {
      'manifest.json': {},
      'breadcrumbs.json': breadcrumbs,
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('Breadcrumbs');
    expect(result).toContain('navigation');
    expect(result).toContain('page load');
  });

  it('shows omitted note when breadcrumbs > 30', async () => {
    const breadcrumbs = Array.from({ length: 35 }, (_, i) => ({
      timestamp: `2026-05-17T10:${String(i).padStart(2, '0')}:00.000Z`,
      category: 'cat',
      message: `msg${i}`,
    }));
    mockBundle('bundle-1', {
      'manifest.json': {},
      'breadcrumbs.json': breadcrumbs,
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('Showing last 30 of 35');
  });

  it('truncates output exceeding MAX_OUTPUT_CHARS', async () => {
    const longStack = 'X'.repeat(15000);
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'main-uncaught-exception' },
      'event.json': {
        origin: 'uncaught',
        error: { name: 'Error', message: 'boom', stack: longStack },
      },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result.length).toBeLessThanOrEqual(12 * 1024 + 200); // allow for the truncation notice
    expect(result).toContain('truncated');
  });

  it('handles cause in error event', async () => {
    mockBundle('bundle-1', {
      'manifest.json': { eventType: 'main-uncaught-exception' },
      'event.json': {
        origin: 'uncaught',
        error: {
          name: 'Error',
          message: 'outer error',
          cause: { name: 'TypeError', message: 'inner error' },
        },
      },
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('Cause');
    expect(result).toContain('inner error');
  });

  it('handles breadcrumb metadata that stringifies to > 200 chars', async () => {
    const longMeta = { data: 'Y'.repeat(300) };
    mockBundle('bundle-1', {
      'manifest.json': {},
      'breadcrumbs.json': [{ timestamp: '2026-05-17T10:00:00.000Z', category: 'x', message: 'y', metadata: longMeta }],
    });
    const result = await executeReadCrashBundle({ bundleName: 'bundle-1' });
    expect(result).toContain('…');
  });
});
