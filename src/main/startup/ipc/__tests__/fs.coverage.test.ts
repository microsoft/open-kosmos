/**
 * fs.ts IPC handler coverage tests
 *
 * Covers all IPC handlers registered by src/main/startup/ipc/fs.ts:
 *   - fs:deletePaths
 *   - fs:exists
 *   - fs:listDir
 *   - fs:access
 *   - fs:readFile
 *   - fs:writeFile
 *   - fs:stat
 *   - fs:expandPath
 *   - fs:selectFile
 *   - fs:getFileMetadata
 *   - fs:downloadFile
 *   - fs:selectFiles
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── hoisted mock vars ─────────────────────────────────────────────────────────

const mockHandle = vi.hoisted(() => vi.fn());
const mockTrashItem = vi.hoisted(() => vi.fn());
const mockShowOpenDialog = vi.hoisted(() => vi.fn());
const mockUserDataPath = vi.hoisted(() => {
  // Use Node's os.tmpdir() for a real writable path.
  // We inline the require here because vi.hoisted runs before imports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('os').tmpdir() as string;
});

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath),
    on: vi.fn(),
  },
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
    on: vi.fn(),
  },
  shell: {
    trashItem: (...args: any[]) => mockTrashItem(...args),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
    showMessageBox: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: vi.fn(() => null),
  },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
}));

vi.mock('../lazy', () => ({
  getAdvancedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared')>();
  return {
    ...actual,
    promptImportConflictResolution: vi.fn().mockResolvedValue('replace'),
    getUniqueImportPath: vi.fn((p: string) => p + ' (1)'),
  };
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Map channel → handler captured by ipcMain.handle */
type HandlerFn = (event: any, ...args: any[]) => Promise<any>;
const handlers: Record<string, HandlerFn> = {};

async function invoke(channel: string, ...args: any[]) {
  const h = handlers[channel];
  if (!h) throw new Error(`No handler registered for ${channel}`);
  return h({} as any, ...args);
}

const WORK_DIR = os.tmpdir();

function makeTmpPath(name: string) {
  return path.join(WORK_DIR, `vitest-fs-${Date.now()}-${name}`);
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mockHandle.mockImplementation((channel: string, fn: HandlerFn) => {
    handlers[channel] = fn;
  });

  const ctx = {
    mainWindow: { id: 1 } as any,
  };

  const mod = await import('../fs');
  mod.default(ctx as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── fs:exists ─────────────────────────────────────────────────────────────────

describe('fs:exists', () => {
  it('returns true for an existing path', async () => {
    const p = makeTmpPath('exists.txt');
    fs.writeFileSync(p, 'hello');
    try {
      const result = await invoke('fs:exists', p);
      expect(result).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('returns false for a non-existent path', async () => {
    const result = await invoke('fs:exists', '/no/such/path/xyz.txt');
    expect(result).toBe(false);
  });
});

// ── fs:listDir ────────────────────────────────────────────────────────────────

describe('fs:listDir', () => {
  it('lists directory entries', async () => {
    const dir = makeTmpPath('dir');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), '');
    fs.mkdirSync(path.join(dir, 'sub'));
    try {
      const result = await invoke('fs:listDir', dir);
      expect(result.success).toBe(true);
      const names = result.entries.map((e: any) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('sub');
      const subEntry = result.entries.find((e: any) => e.name === 'sub');
      expect(subEntry.isDirectory).toBe(true);
      expect(subEntry.isFile).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('returns error for non-existent directory', async () => {
    const result = await invoke('fs:listDir', '/no/such/dir/zzz');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── fs:access ─────────────────────────────────────────────────────────────────

describe('fs:access', () => {
  it('returns readable+writable for a writable file', async () => {
    const p = makeTmpPath('access.txt');
    fs.writeFileSync(p, 'data');
    try {
      const result = await invoke('fs:access', p);
      expect(result.readable).toBe(true);
      expect(result.writable).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('returns not readable for non-existent file', async () => {
    const result = await invoke('fs:access', '/no/such/file.txt');
    expect(result.readable).toBe(false);
    expect(result.writable).toBe(false);
  });
});

// ── fs:readFile ───────────────────────────────────────────────────────────────

describe('fs:readFile', () => {
  it('reads a text file', async () => {
    const p = makeTmpPath('read.txt');
    fs.writeFileSync(p, 'hello world');
    try {
      const result = await invoke('fs:readFile', p);
      expect(result.success).toBe(true);
      expect(result.content).toBe('hello world');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('reads file as base64', async () => {
    const p = makeTmpPath('read-b64.bin');
    fs.writeFileSync(p, Buffer.from([1, 2, 3]));
    try {
      const result = await invoke('fs:readFile', p, 'base64');
      expect(result.success).toBe(true);
      expect(result.content).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('returns error for missing file', async () => {
    const result = await invoke('fs:readFile', '/no/such/file.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── fs:writeFile ──────────────────────────────────────────────────────────────

describe('fs:writeFile', () => {
  it('writes a new file', async () => {
    const p = makeTmpPath('write-new.txt');
    try {
      const result = await invoke('fs:writeFile', p, 'hello');
      expect(result.success).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('hello');
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('rejects when file already exists with default strategy', async () => {
    const p = makeTmpPath('write-reject.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new-content');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('replaces file with replace strategy', async () => {
    const p = makeTmpPath('write-replace.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'replaced', undefined, {
        conflictResolution: 'replace',
      });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('replaced');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('skips when file already exists with skip strategy', async () => {
    const p = makeTmpPath('write-skip.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new', undefined, {
        conflictResolution: 'skip',
      });
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('original');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('keep-both renames destination when file already exists', async () => {
    const p = makeTmpPath('write-keep.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new', undefined, {
        conflictResolution: 'keep-both',
      });
      expect(result.success).toBe(true);
      expect(result.renamed).toBe(true);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      const renamed = p.replace('.txt', '') + ' (1).txt';
      if (fs.existsSync(renamed)) fs.unlinkSync(renamed);
      // also clean up anything ending with (1)
      const altPath = p + ' (1)';
      if (fs.existsSync(altPath)) fs.unlinkSync(altPath);
    }
  });

  it('creates intermediate directories', async () => {
    const dir = makeTmpPath('nested');
    const p = path.join(dir, 'subdir', 'file.txt');
    try {
      const result = await invoke('fs:writeFile', p, 'content');
      expect(result.success).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('content');
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('prompt strategy — cancel', async () => {
    const { promptImportConflictResolution } = await import('../shared');
    (promptImportConflictResolution as any).mockResolvedValueOnce('cancel');

    const p = makeTmpPath('write-prompt-cancel.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new', undefined, {
        conflictResolution: 'prompt',
      });
      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('prompt strategy — skip', async () => {
    const { promptImportConflictResolution } = await import('../shared');
    (promptImportConflictResolution as any).mockResolvedValueOnce('skip');

    const p = makeTmpPath('write-prompt-skip.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new', undefined, {
        conflictResolution: 'prompt',
      });
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('prompt strategy — keep-both', async () => {
    const { promptImportConflictResolution } = await import('../shared');
    (promptImportConflictResolution as any).mockResolvedValueOnce('keep-both');

    const p = makeTmpPath('write-prompt-keepboth.txt');
    fs.writeFileSync(p, 'original');
    try {
      const result = await invoke('fs:writeFile', p, 'new', undefined, {
        conflictResolution: 'prompt',
      });
      expect(result.success).toBe(true);
      expect(result.renamed).toBe(true);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      const alt = p + ' (1)';
      if (fs.existsSync(alt)) fs.unlinkSync(alt);
    }
  });
});

// ── fs:stat ───────────────────────────────────────────────────────────────────

describe('fs:stat', () => {
  it('returns stats for existing file', async () => {
    const p = makeTmpPath('stat.txt');
    fs.writeFileSync(p, 'abc');
    try {
      const result = await invoke('fs:stat', p);
      expect(result.success).toBe(true);
      expect(result.stats.isFile).toBe(true);
      expect(result.stats.isDirectory).toBe(false);
      expect(result.stats.size).toBe(3);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('returns error for missing file', async () => {
    const result = await invoke('fs:stat', '/no/such/file.txt');
    expect(result.success).toBe(false);
  });
});

// ── fs:expandPath ─────────────────────────────────────────────────────────────

describe('fs:expandPath', () => {
  it('expands tilde to home directory', async () => {
    const result = await invoke('fs:expandPath', '~/Documents');
    expect(result).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('passes through absolute paths unchanged', async () => {
    const result = await invoke('fs:expandPath', '/absolute/path');
    expect(result).toBe('/absolute/path');
  });

  it('expands Unix-style env vars', async () => {
    process.env.TEST_EXPAND_VAR = '/my/test/dir';
    const result = await invoke('fs:expandPath', '$TEST_EXPAND_VAR/file.txt');
    expect(result).toBe('/my/test/dir/file.txt');
    delete process.env.TEST_EXPAND_VAR;
  });
});

// ── fs:selectFile ─────────────────────────────────────────────────────────────

describe('fs:selectFile', () => {
  it('returns selected file path (new API format)', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/some/file.json'] });
    const result = await invoke('fs:selectFile');
    expect(result.success).toBe(true);
    expect(result.filePath).toBe('/some/file.json');
  });

  it('returns error when canceled (new API)', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const result = await invoke('fs:selectFile');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/canceled/i);
  });

  it('returns error when no main window', async () => {
    // Reload with null mainWindow
    const handlers2: Record<string, HandlerFn> = {};
    const handle2 = vi.fn((ch: string, fn: HandlerFn) => { handlers2[ch] = fn; });
    mockHandle.mockImplementation((ch: string, fn: HandlerFn) => handle2(ch, fn));

    const mod = await import('../fs?nocache=' + Date.now());
    mod.default({ mainWindow: null } as any);

    const result = await handlers2['fs:selectFile']({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No main window/);

    // Restore
    mockHandle.mockImplementation((ch: string, fn: HandlerFn) => { handlers[ch] = fn; });
  });

  it('handles old array API format', async () => {
    mockShowOpenDialog.mockResolvedValueOnce(['/old/api/file.json']);
    const result = await invoke('fs:selectFile');
    expect(result.success).toBe(true);
    expect(result.filePath).toBe('/old/api/file.json');
  });

  it('handles empty old array API format', async () => {
    mockShowOpenDialog.mockResolvedValueOnce([]);
    const result = await invoke('fs:selectFile');
    expect(result.success).toBe(false);
  });
});

// ── fs:selectFiles ────────────────────────────────────────────────────────────

describe('fs:selectFiles', () => {
  it('returns selected file paths', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/a.txt', '/b.txt'] });
    const result = await invoke('fs:selectFiles', { allowMultiple: true });
    expect(result.success).toBe(true);
    expect(result.filePaths).toEqual(['/a.txt', '/b.txt']);
  });

  it('returns error when canceled', async () => {
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const result = await invoke('fs:selectFiles');
    expect(result.success).toBe(false);
  });

  it('handles old array API format', async () => {
    mockShowOpenDialog.mockResolvedValueOnce(['/old.txt']);
    const result = await invoke('fs:selectFiles');
    expect(result.success).toBe(true);
    expect(result.filePaths).toEqual(['/old.txt']);
  });

  it('returns error when no main window', async () => {
    const handlers3: Record<string, HandlerFn> = {};
    const handle3 = vi.fn((ch: string, fn: HandlerFn) => { handlers3[ch] = fn; });
    mockHandle.mockImplementation((ch: string, fn: HandlerFn) => handle3(ch, fn));

    const mod = await import('../fs?nocache2=' + Date.now());
    mod.default({ mainWindow: null } as any);

    const result = await handlers3['fs:selectFiles']({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No main window/);

    mockHandle.mockImplementation((ch: string, fn: HandlerFn) => { handlers[ch] = fn; });
  });
});

// ── fs:deletePaths ────────────────────────────────────────────────────────────

describe('fs:deletePaths', () => {
  it('moves existing file to trash', async () => {
    const p = makeTmpPath('delete.txt');
    fs.writeFileSync(p, 'data');
    mockTrashItem.mockResolvedValueOnce(undefined);

    const result = await invoke('fs:deletePaths', [p]);
    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(mockTrashItem).toHaveBeenCalledWith(p);
  });

  it('reports failure for non-existent path', async () => {
    const result = await invoke('fs:deletePaths', ['/no/such/path/xyz.txt']);
    expect(result.success).toBe(false);
    expect(result.failCount).toBe(1);
    expect(result.results[0].error).toMatch(/does not exist/);
  });

  it('falls back to fs.unlinkSync when trashItem fails on a file', async () => {
    const p = makeTmpPath('delete-fallback.txt');
    fs.writeFileSync(p, 'data');
    mockTrashItem.mockRejectedValueOnce(new Error('trash failed'));

    const result = await invoke('fs:deletePaths', [p]);
    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
    // file is gone
    expect(fs.existsSync(p)).toBe(false);
  });

  it('falls back to fs.rmSync when trashItem fails on a directory', async () => {
    const dir = makeTmpPath('delete-dir');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'inner.txt'), 'x');
    mockTrashItem.mockRejectedValueOnce(new Error('trash failed'));

    const result = await invoke('fs:deletePaths', [dir]);
    expect(result.success).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('handles multiple paths with mixed success', async () => {
    const existing = makeTmpPath('multi-exist.txt');
    fs.writeFileSync(existing, 'x');
    mockTrashItem.mockResolvedValueOnce(undefined);

    const result = await invoke('fs:deletePaths', [existing, '/no/such/path']);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.success).toBe(false);
  });
});

// ── fs:getFileMetadata ────────────────────────────────────────────────────────

describe('fs:getFileMetadata', () => {
  it('returns metadata for a text file', async () => {
    const p = makeTmpPath('meta.ts');
    fs.writeFileSync(p, 'const x = 1;\nconst y = 2;\n');
    try {
      const result = await invoke('fs:getFileMetadata', p);
      expect(result.success).toBe(true);
      expect(result.metadata.isTextFile).toBe(true);
      expect(result.metadata.mimeType).toBe('text/typescript');
      expect(result.metadata.lineCount).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('uses text/plain for unknown extension', async () => {
    const p = makeTmpPath('file.xyz');
    fs.writeFileSync(p, 'data');
    try {
      const result = await invoke('fs:getFileMetadata', p);
      expect(result.success).toBe(true);
      expect(result.metadata.mimeType).toBe('text/plain');
      expect(result.metadata.isTextFile).toBe(false);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('returns error for missing file', async () => {
    const result = await invoke('fs:getFileMetadata', '/no/such/file.txt');
    expect(result.success).toBe(false);
  });
});

// ── fs:downloadFile ───────────────────────────────────────────────────────────

describe('fs:downloadFile', () => {
  it('downloads file from URL and writes to disk', async () => {
    const destPath = makeTmpPath('downloaded.txt');
    const mockBody = 'hello from server';
    const bodyBytes = new TextEncoder().encode(mockBody);
    // Use a properly-bounded ArrayBuffer (no extra pool bytes)
    const arrayBuffer = bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength);
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    try {
      const result = await invoke('fs:downloadFile', 'https://example.com/test.txt', destPath);
      expect(result.success).toBe(true);
      expect(result.filePath).toBe(destPath);
      expect(fs.readFileSync(destPath).toString()).toBe(mockBody);
    } finally {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      vi.unstubAllGlobals();
    }
  });

  it('returns error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    try {
      const result = await invoke('fs:downloadFile', 'https://example.com/missing', '/tmp/missing');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/HTTP error/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('creates missing destination directory', async () => {
    const dir = makeTmpPath('dl-dir');
    const destPath = path.join(dir, 'sub', 'file.txt');
    const mockBody = 'content';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(mockBody).buffer),
    }));
    try {
      const result = await invoke('fs:downloadFile', 'https://example.com/f', destPath);
      expect(result.success).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});
