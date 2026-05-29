import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

const { mockGetCurrentLogFileName, mockGetDefaultLogDirectory, mockIsDevelopmentLogEnvironment } = vi.hoisted(() => ({
  mockGetCurrentLogFileName: vi.fn(() => 'kosmos-dev-2026-05-17-10-00-00.log'),
  mockGetDefaultLogDirectory: vi.fn(() => '/mock/logs'),
  mockIsDevelopmentLogEnvironment: vi.fn(() => true),
}));

vi.mock('../../../unifiedLogger/FileOperations', () => ({
  getCurrentLogFileName: mockGetCurrentLogFileName,
  getDefaultLogDirectory: mockGetDefaultLogDirectory,
  isDevelopmentLogEnvironment: mockIsDevelopmentLogEnvironment,
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

import { executeReadAppLogs, readAppLogsToolDef } from '../readAppLogs';
import * as fs from 'fs';

const LOG_LINE = (ts: string, level: string, source: string, msg: string) =>
  `${ts} ${level} [${source}] ${msg}`;

const SAMPLE_LOG = [
  LOG_LINE('2026-05-17T10:00:00.000Z', 'INFO', 'Auth', 'User signed in'),
  LOG_LINE('2026-05-17T10:01:00.000Z', 'ERROR', 'MCP', 'Connection failed'),
  LOG_LINE('2026-05-17T10:02:00.000Z', 'WARN', 'Chat', 'Slow response'),
  LOG_LINE('2026-05-17T10:03:00.000Z', 'DEBUG', 'Scheduler', 'tick'),
].join('\n');

describe('readAppLogsToolDef', () => {
  it('has correct name', () => {
    expect(readAppLogsToolDef.function.name).toBe('read_app_logs');
  });
});

describe('executeReadAppLogs — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when args is null/undefined', async () => {
    const r = await executeReadAppLogs(null as any);
    expect(r).toContain('Error');
  });

  it('returns error when mode is missing', async () => {
    const r = await executeReadAppLogs({ mode: undefined as any });
    expect(r).toContain('"mode" is required');
  });

  it('returns error for invalid mode', async () => {
    const r = await executeReadAppLogs({ mode: 'invalid' as any });
    expect(r).toContain('"mode" is required');
  });

  it('returns error for unknown keys', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', unknownKey: 'x' } as any);
    expect(r).toContain('unknown parameter');
  });

  it('returns error when level is not array', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', level: 'ERROR' as any });
    expect(r).toContain('"level" must be an array');
  });

  it('returns error for invalid level values', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', level: ['CRITICAL'] });
    expect(r).toContain('invalid level');
  });

  it('returns error for invalid scope', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', scope: 'recent' as any });
    expect(r).toContain('"scope" must be');
  });

  it('returns error for invalid from timestamp', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', from: 'not-a-date' });
    expect(r).toContain('"from" is not a recognizable timestamp');
  });

  it('returns error for invalid to timestamp', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', to: 'bad' });
    expect(r).toContain('"to" is not a recognizable timestamp');
  });

  it('returns error when from > to', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', from: '2026-05-18', to: '2026-05-17' });
    expect(r).toContain('later than');
  });

  it('returns error for empty grep', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', grep: '' });
    expect(r).toContain('"grep" must be a non-empty string');
  });

  it('returns error for invalid regex in grep', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', grep: '/[invalid(/' });
    expect(r).toContain('invalid regex');
  });

  it('returns error for empty source', async () => {
    const r = await executeReadAppLogs({ mode: 'stats', source: '' });
    expect(r).toContain('"source" must be a non-empty glob string');
  });

  it('returns error for non-positive limit', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', limit: -1 });
    expect(r).toContain('"limit" must be a positive number');
  });

  it('returns error for non-numeric limit', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', limit: NaN });
    expect(r).toContain('"limit" must be a positive number');
  });
});

describe('executeReadAppLogs — no logs dir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('returns "No logs directory found" message', async () => {
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('No logs directory found');
  });
});

describe('executeReadAppLogs — no log files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  it('returns "No log files found." message', async () => {
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('No log files found.');
  });
});

function setupLogFiles(content: string, filename = 'kosmos-dev-2026-05-17-10-00-00.log') {
  vi.mocked(fs.existsSync).mockImplementation((p: any) => {
    return p === '/mock/logs' || p === `/mock/logs/${filename}`;
  });
  vi.mocked(fs.readdirSync).mockReturnValue([filename] as any);
  vi.mocked(fs.statSync).mockReturnValue({ size: content.length, mtimeMs: Date.now() } as any);
  vi.mocked(fs.readFileSync).mockReturnValue(content);
}

describe('executeReadAppLogs — stats mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLogFiles(SAMPLE_LOG);
  });

  it('returns stats output with total entry count', async () => {
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('Log Statistics');
    expect(r).toContain('4');
  });

  it('includes level breakdown', async () => {
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('ERROR');
    expect(r).toContain('WARN');
    expect(r).toContain('INFO');
    expect(r).toContain('DEBUG');
  });
});

describe('executeReadAppLogs — sources mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLogFiles(SAMPLE_LOG);
  });

  it('returns list of sources', async () => {
    const r = await executeReadAppLogs({ mode: 'sources' });
    expect(r).toContain('Auth');
    expect(r).toContain('MCP');
    expect(r).toContain('Chat');
  });
});

describe('executeReadAppLogs — entries mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLogFiles(SAMPLE_LOG);
  });

  it('returns filtered entries', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', level: ['error'] });
    expect(r).toContain('Connection failed');
    expect(r).not.toContain('User signed in');
  });

  it('filters by source glob', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', source: 'mc*' });
    expect(r).toContain('Connection failed');
    expect(r).not.toContain('User signed in');
  });

  it('filters by grep', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', grep: 'signed' });
    expect(r).toContain('User signed in');
    expect(r).not.toContain('Connection failed');
  });

  it('filters by time window', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', from: '2026-05-17T10:01:00Z', to: '2026-05-17T10:01:59Z' });
    expect(r).toContain('Connection failed');
    expect(r).not.toContain('User signed in');
  });

  it('returns no entries hint when filters too tight', async () => {
    const r = await executeReadAppLogs({ mode: 'entries', source: 'nonexistent*' });
    expect(r).toContain('No log entries match');
  });

  it('respects default limit of 50', async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      LOG_LINE(`2026-05-17T10:${String(i % 60).padStart(2, '0')}:00.000Z`, 'INFO', 'Test', `msg${i}`)
    ).join('\n');
    setupLogFiles(lines);
    const r = await executeReadAppLogs({ mode: 'entries' });
    // Should show 50 entries and truncation note
    expect(r).toContain('truncated');
  });

  it('respects custom limit', async () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      LOG_LINE(`2026-05-17T10:${String(i).padStart(2, '0')}:00.000Z`, 'INFO', 'Test', `msg${i}`)
    ).join('\n');
    setupLogFiles(lines);
    const r = await executeReadAppLogs({ mode: 'entries', limit: 5 });
    const count = (r.match(/\d{2}:\d{2}:\d{2}/g) || []).length;
    expect(count).toBeLessThanOrEqual(10); // 5 entries + staleness header timestamps
  });

  it('clamps limit to hard cap of 200', async () => {
    const lines = Array.from({ length: 250 }, (_, i) =>
      LOG_LINE(`2026-05-17T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, 'INFO', 'T', `msg${i}`)
    ).join('\n');
    setupLogFiles(lines);
    const r = await executeReadAppLogs({ mode: 'entries', limit: 500 });
    expect(r).toContain('truncated');
  });
});

describe('executeReadAppLogs — scope=all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads all log files', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'kosmos-2026-05-16.log',
      'kosmos-2026-05-17.log',
    ] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: SAMPLE_LOG.length, mtimeMs: Date.now() } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_LOG);
    const r = await executeReadAppLogs({ mode: 'stats', scope: 'all' });
    expect(r).toContain('[Scope] all');
  });
});

describe('executeReadAppLogs — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips files exceeding 64MB', async () => {
    const bigSize = 65 * 1024 * 1024;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['big.log'] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: bigSize, mtimeMs: Date.now() } as any);
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('Skipped');
  });

  it('warns when lines parsed = 0', async () => {
    setupLogFiles('not a log line\nanother bad line');
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('parsed 0 valid log entries');
  });

  it('falls back to most recent file when current file missing', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      if (p === '/mock/logs') return true;
      if (p === '/mock/logs/kosmos-dev-2026-05-17-10-00-00.log') return false;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(['kosmos-2026-05-16.log'] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: SAMPLE_LOG.length, mtimeMs: Date.now() } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_LOG);
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('falling back');
  });

  it('handles prod mode scope notice', async () => {
    mockIsDevelopmentLogEnvironment.mockReturnValue(false);
    mockGetCurrentLogFileName.mockReturnValue('kosmos-2026-05-17.log');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['kosmos-2026-05-17.log'] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: SAMPLE_LOG.length, mtimeMs: Date.now() } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_LOG);
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('prod');
  });

  it('handles prod mode scope notice — fallback case', async () => {
    mockIsDevelopmentLogEnvironment.mockReturnValue(false);
    mockGetCurrentLogFileName.mockReturnValue('kosmos-2026-05-17.log');
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      if (p === '/mock/logs') return true;
      if (p === '/mock/logs/kosmos-2026-05-17.log') return false;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(['kosmos-2026-05-16.log'] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: SAMPLE_LOG.length, mtimeMs: Date.now() } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_LOG);
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('falling back');
  });

  it('handles read failure on a file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['kosmos-dev-2026-05-17-10-00-00.log'] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: 100, mtimeMs: Date.now() } as any);
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('EPERM'); });
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('Skipped');
  });

  it('handles stat failure on a file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['kosmos-dev-2026-05-17-10-00-00.log'] as any);
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('EPERM'); });
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('No log');
  });

  it('returns hint with suggestions when no entries match with filters', async () => {
    setupLogFiles(SAMPLE_LOG);
    const r = await executeReadAppLogs({
      mode: 'entries',
      source: 'unknown*',
      grep: 'xyz',
      from: '2026-05-17',
      to: '2026-05-17',
    });
    expect(r).toContain('Suggestions');
  });

  it('readdirSync throws for logsDir', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('EPERM'); });
    const r = await executeReadAppLogs({ mode: 'stats' });
    expect(r).toContain('No log files found.');
  });
});
