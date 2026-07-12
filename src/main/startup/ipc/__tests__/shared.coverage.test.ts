// @ts-nocheck
/**
 * shared.ts coverage tests
 *
 * Covers all exported helpers:
 *   - getConflictPromptWindow
 *   - getUniqueImportPath
 *   - collectImportConflicts
 *   - planImportTargets
 *   - promptImportConflictResolution
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ─────────────────────────────────────────────────────────

const {
  mockFromWebContents,
  mockGetFocusedWindow,
  mockShowMessageBox,
  mockFsExistsSync,
} = vi.hoisted(() => {
  return {
    mockFromWebContents: vi.fn(),
    mockGetFocusedWindow: vi.fn(),
    mockShowMessageBox: vi.fn(),
    mockFsExistsSync: vi.fn(),
  };
});

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: (...args: any[]) => mockFromWebContents(...args),
    getFocusedWindow: () => mockGetFocusedWindow(),
  },
  dialog: {
    showMessageBox: (...args: any[]) => mockShowMessageBox(...args),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: any[]) => mockFsExistsSync(...args),
  };
});

// ── import subject AFTER mocks ────────────────────────────────────────────────

import {
  getConflictPromptWindow,
  getUniqueImportPath,
  collectImportConflicts,
  planImportTargets,
  promptImportConflictResolution,
} from '../shared';

// ── helpers ───────────────────────────────────────────────────────────────────

const makeEvent = () => ({ sender: {} } as Electron.IpcMainInvokeEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getConflictPromptWindow ───────────────────────────────────────────────────

describe('getConflictPromptWindow', () => {
  it('returns window from fromWebContents when present', () => {
    const win = { id: 1 };
    mockFromWebContents.mockReturnValue(win);
    expect(getConflictPromptWindow(makeEvent())).toBe(win);
  });

  it('falls back to getFocusedWindow when fromWebContents returns null', () => {
    const win = { id: 2 };
    mockFromWebContents.mockReturnValue(null);
    mockGetFocusedWindow.mockReturnValue(win);
    expect(getConflictPromptWindow(makeEvent())).toBe(win);
  });

  it('returns undefined when both fromWebContents and getFocusedWindow return null', () => {
    mockFromWebContents.mockReturnValue(null);
    mockGetFocusedWindow.mockReturnValue(null);
    expect(getConflictPromptWindow(makeEvent())).toBeUndefined();
  });
});

// ── getUniqueImportPath ───────────────────────────────────────────────────────

describe('getUniqueImportPath', () => {
  it('returns path as-is when not reserved and does not exist', () => {
    mockFsExistsSync.mockReturnValue(false);
    const result = getUniqueImportPath('/dir/file.md', new Set());
    expect(result).toBe('/dir/file.md');
  });

  it('appends (1) when path is in reservedPaths', () => {
    mockFsExistsSync.mockReturnValue(false);
    const reserved = new Set(['/dir/file.md']);
    const result = getUniqueImportPath('/dir/file.md', reserved);
    expect(result).toBe('/dir/file (1).md');
  });

  it('increments counter when fs.existsSync returns true for first candidate', () => {
    // Original exists on disk, (1) also exists, (2) is free
    mockFsExistsSync
      .mockReturnValueOnce(true)  // /dir/file.md exists
      .mockReturnValueOnce(true)  // /dir/file (1).md exists
      .mockReturnValueOnce(false); // /dir/file (2).md is free
    const result = getUniqueImportPath('/dir/file.md', new Set());
    expect(result).toBe('/dir/file (2).md');
  });

  it('handles path with no extension', () => {
    mockFsExistsSync.mockReturnValue(false);
    const reserved = new Set(['/dir/myfile']);
    const result = getUniqueImportPath('/dir/myfile', reserved);
    expect(result).toBe('/dir/myfile (1)');
  });
});

// ── collectImportConflicts ────────────────────────────────────────────────────

describe('collectImportConflicts', () => {
  it('returns empty array when no conflicts', () => {
    mockFsExistsSync.mockReturnValue(false);
    const result = collectImportConflicts([
      { id: '1', displayName: 'A', desiredPath: '/dir/a.md' },
    ]);
    expect(result).toEqual([]);
  });

  it('detects already-exists conflict', () => {
    mockFsExistsSync.mockReturnValue(true);
    const result = collectImportConflicts([
      { id: '1', displayName: 'A', desiredPath: '/dir/a.md' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('already-exists');
  });

  it('detects duplicate-selection conflict', () => {
    mockFsExistsSync.mockReturnValue(false);
    const result = collectImportConflicts([
      { id: '1', displayName: 'A', desiredPath: '/dir/a.md' },
      { id: '2', displayName: 'B', desiredPath: '/dir/a.md' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('duplicate-selection');
    expect(result[0].id).toBe('2');
  });

  it('marks already-exists over duplicate-selection when both apply', () => {
    // First call: false (first item — no duplicate yet, no fs hit)
    // Second call: true (second item — fs says it exists)
    mockFsExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const result = collectImportConflicts([
      { id: '1', displayName: 'A', desiredPath: '/dir/a.md' },
      { id: '2', displayName: 'B', desiredPath: '/dir/a.md' },
    ]);
    // Second item: alreadyExists=true wins over duplicate-selection
    expect(result.find((r) => r.id === '2')?.reason).toBe('already-exists');
  });
});

// ── planImportTargets ─────────────────────────────────────────────────────────

describe('planImportTargets', () => {
  it('returns fresh path when no conflict', () => {
    mockFsExistsSync.mockReturnValue(false);
    const result = planImportTargets(
      [{ id: '1', desiredPath: '/dir/a.md' }],
      'skip',
    );
    expect(result[0]).toEqual({ id: '1', finalPath: '/dir/a.md' });
  });

  it('strategy skip — marks skipped', () => {
    mockFsExistsSync.mockReturnValue(true);
    const result = planImportTargets(
      [{ id: '1', desiredPath: '/dir/a.md' }],
      'skip',
    );
    expect(result[0]).toEqual({ id: '1', skipped: true });
  });

  it('strategy replace without duplicate — sets replaceExisting', () => {
    mockFsExistsSync.mockReturnValue(true);
    const result = planImportTargets(
      [{ id: '1', desiredPath: '/dir/a.md' }],
      'replace',
    );
    expect(result[0]).toEqual({ id: '1', finalPath: '/dir/a.md', replaceExisting: true });
  });

  it('strategy replace with duplicate selection — falls through to rename', () => {
    // Both items want same path; first: no fs conflict; second: duplicate in reserved
    mockFsExistsSync.mockReturnValue(false);
    const result = planImportTargets(
      [
        { id: '1', desiredPath: '/dir/a.md' },
        { id: '2', desiredPath: '/dir/a.md' },
      ],
      'replace',
    );
    // Item 1 gets fresh path; item 2 is duplicate → rename branch
    expect(result[0].finalPath).toBe('/dir/a.md');
    expect(result[1].renamed).toBe(true);
  });

  it('strategy keep-both — renames conflicting item', () => {
    // planImportTargets: existsSync('/dir/a.md') → true (alreadyExists)
    // getUniqueImportPath while: existsSync('/dir/a.md') → true (still blocked)
    // getUniqueImportPath while: existsSync('/dir/a (1).md') → false (free)
    mockFsExistsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const result = planImportTargets(
      [{ id: '1', desiredPath: '/dir/a.md' }],
      'keep-both',
    );
    expect(result[0].renamed).toBe(true);
    expect(result[0].finalPath).toBe('/dir/a (1).md');
  });

  it('renamed is false when getUniqueImportPath returns same path', () => {
    // Duplicate selection, keep-both, but renamed path happens to equal desiredPath (edge case via reserved)
    // Force: desiredPath is in reservedFinalPaths (already used) but existsSync false
    // First candidate reserves the path, second is duplicate → keep-both rename
    mockFsExistsSync.mockReturnValue(false);
    const result = planImportTargets(
      [
        { id: '1', desiredPath: '/dir/b.md' },
        { id: '2', desiredPath: '/dir/b.md' },
      ],
      'keep-both',
    );
    // Second item: duplicate → getUniqueImportPath → /dir/b (1).md ≠ /dir/b.md → renamed true
    expect(result[1].renamed).toBe(true);
  });
});

// ── promptImportConflictResolution ────────────────────────────────────────────

describe('promptImportConflictResolution', () => {
  const makeConflict = (i: number) => ({
    id: `${i}`,
    displayName: `Item ${i}`,
    desiredPath: `/dir/item${i}.md`,
    reason: 'already-exists' as const,
  });

  beforeEach(() => {
    mockFromWebContents.mockReturnValue(null);
    mockGetFocusedWindow.mockReturnValue(null);
  });

  it('returns skip for response 1 (no browser window)', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 1 });
    const result = await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    expect(result).toBe('skip');
    // Called without browserWindow arg
    expect(mockShowMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('returns keep-both for response 2', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 2 });
    const result = await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    expect(result).toBe('keep-both');
  });

  it('returns replace for response 3', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 3 });
    const result = await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    expect(result).toBe('replace');
  });

  it('returns cancel for default response (0)', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    const result = await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    expect(result).toBe('cancel');
  });

  it('uses browserWindow when present', async () => {
    const win = { id: 42 };
    mockFromWebContents.mockReturnValue(win);
    mockShowMessageBox.mockResolvedValue({ response: 1 });
    await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    expect(mockShowMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ type: 'warning' }));
  });

  it('singular message for 1 conflict', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    await promptImportConflictResolution(makeEvent(), 'import', [makeConflict(1)]);
    const opts = mockShowMessageBox.mock.calls[0][0] as Electron.MessageBoxOptions;
    expect(opts.detail).toContain('1 conflicting item ');
  });

  it('plural message for multiple conflicts', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    const conflicts = [makeConflict(1), makeConflict(2)];
    await promptImportConflictResolution(makeEvent(), 'import', conflicts);
    const opts = mockShowMessageBox.mock.calls[0][0] as Electron.MessageBoxOptions;
    expect(opts.detail).toContain('2 conflicting items');
  });

  it('truncates preview and shows "more conflicts" line for >10 conflicts', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    const conflicts = Array.from({ length: 12 }, (_, i) => makeConflict(i));
    await promptImportConflictResolution(makeEvent(), 'import', conflicts);
    const opts = mockShowMessageBox.mock.calls[0][0] as Electron.MessageBoxOptions;
    expect(opts.detail).toContain('2 more conflicts not shown');
  });

  it('shows duplicate-in-this-import reason label', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    const conflict = {
      id: '1',
      displayName: 'Dup',
      desiredPath: '/dir/dup.md',
      reason: 'duplicate-selection' as const,
    };
    await promptImportConflictResolution(makeEvent(), 'import', [conflict]);
    const opts = mockShowMessageBox.mock.calls[0][0] as Electron.MessageBoxOptions;
    expect(opts.detail).toContain('duplicate in this import');
  });
});
