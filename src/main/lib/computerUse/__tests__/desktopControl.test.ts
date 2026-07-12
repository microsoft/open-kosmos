import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const getPrimaryDisplay = vi.fn();
const getAllDisplays = vi.fn();
const dipToScreenPoint = vi.fn();
const getSources = vi.fn();
const appOnce = vi.fn();
const unlinkSyncSpy = vi.fn();

vi.mock('electron', () => ({
  app: {
    once: (...a: unknown[]) => appOnce(...(a as [])),
  },
  screen: {
    getPrimaryDisplay: (...a: unknown[]) => getPrimaryDisplay(...(a as [])),
    getAllDisplays: (...a: unknown[]) => getAllDisplays(...(a as [])),
    dipToScreenPoint: (...a: unknown[]) => dipToScreenPoint(...(a as [])),
  },
  desktopCapturer: {
    getSources: (...a: unknown[]) => getSources(...(a as [])),
  },
}));

vi.mock('fs', () => ({
  unlinkSync: (...a: unknown[]) => unlinkSyncSpy(...(a as [])),
}));

import {
  parseMacAppList,
  parseWinForeground,
  selectCaptureSource,
  psQuote,
  asQuote,
  createDefaultDesktopControl,
  cleanupForegroundProbe,
  DEFAULT_COMMAND_RUNNER_OPTIONS,
  defaultCommandRunner,
  fitWithinLongEdge,
  type CommandRunner,
} from '../desktopControl';

function display(id: number, scaleFactor = 2) {
  return {
    id,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    size: { width: 1440, height: 900 },
    scaleFactor,
  };
}

function fakeSource(displayId: number, empty = false) {
  return {
    display_id: String(displayId),
    thumbnail: {
      isEmpty: () => empty,
      getSize: () => ({ width: 1280, height: 800 }),
      toJPEG: (_quality: number) => Buffer.from('jpeg-bytes'),
    },
  };
}

/** Source with a controllable display_id (default empty, as Windows commonly reports) and a
 * distinct JPEG marker so a test can prove which source was selected. */
function markedSource(marker: string, displayId = '') {
  return {
    display_id: displayId,
    thumbnail: {
      isEmpty: () => false,
      getSize: () => ({ width: 1280, height: 800 }),
      toJPEG: (_quality: number) => Buffer.from(marker),
    },
  };
}

beforeEach(() => {
  getPrimaryDisplay.mockReset();
  getAllDisplays.mockReset();
  dipToScreenPoint.mockReset();
  getSources.mockReset();
  appOnce.mockReset();
  unlinkSyncSpy.mockReset();
});

describe('parseMacAppList', () => {
  it('trims and drops blanks', () => {
    expect(parseMacAppList('Safari, Notes ,  , Mail')).toEqual(['Safari', 'Notes', 'Mail']);
  });
  it('returns empty for blank input', () => {
    expect(parseMacAppList('   ')).toEqual([]);
  });
});

describe('psQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(psQuote('plain')).toBe("'plain'");
  });
  it('doubles embedded single quotes', () => {
    expect(psQuote("Bob's App")).toBe("'Bob''s App'");
  });
  it('handles multiple single quotes', () => {
    expect(psQuote("a'b'c")).toBe("'a''b''c'");
  });
});

describe('asQuote', () => {
  it('leaves a plain value untouched', () => {
    expect(asQuote('Safari')).toBe('Safari');
  });
  it('escapes double quotes and backslashes so the literal cannot be closed', () => {
    expect(asQuote('a"b')).toBe('a\\"b');
    expect(asQuote('a\\b')).toBe('a\\\\b');
  });
  it('escapes newlines and carriage returns to neutralize injected statements', () => {
    expect(asQuote('a\nb')).toBe('a\\nb');
    expect(asQuote('a\r\nb')).toBe('a\\r\\nb');
  });
});

describe('parseWinForeground', () => {
  it('uses the friendly name and keeps the process name as a candidate', () => {
    expect(parseWinForeground('msedge\tMicrosoft Edge\tInbox')).toEqual({
      name: 'Microsoft Edge',
      candidates: ['Microsoft Edge', 'msedge'],
    });
  });
  it('falls back to the process name when no friendly name is present', () => {
    expect(parseWinForeground('explorer\t\t')).toEqual({
      name: 'explorer',
      candidates: ['explorer'],
    });
  });
  it('treats a process-only line (no tabs) as the name', () => {
    expect(parseWinForeground('WeChat\r\n')).toEqual({ name: 'WeChat', candidates: ['WeChat'] });
  });
  it('deduplicates when the friendly name equals the process name', () => {
    expect(parseWinForeground('Code\tCode\ttitle')).toEqual({ name: 'Code', candidates: ['Code'] });
  });
  it('skips leading blank lines and trims', () => {
    expect(parseWinForeground('\r\n  chrome\tGoogle Chrome\t  ')).toEqual({
      name: 'Google Chrome',
      candidates: ['Google Chrome', 'chrome'],
    });
  });
  it('returns undefined for empty output', () => {
    expect(parseWinForeground('')).toBeUndefined();
  });
  it('returns undefined for whitespace-only output', () => {
    expect(parseWinForeground('   \r\n  \n')).toBeUndefined();
  });
});

describe('selectCaptureSource', () => {
  const sources = [
    { display_id: '10', tag: 'a' },
    { display_id: '', tag: 'b' },
    { display_id: '30', tag: 'c' },
  ];
  it('returns undefined when there are no sources', () => {
    expect(selectCaptureSource([], 1, 0)).toBeUndefined();
  });
  it('matches by display_id first', () => {
    expect(selectCaptureSource(sources, 30, 0)?.tag).toBe('c');
  });
  it('falls back to the positional index when no id matches', () => {
    expect(selectCaptureSource(sources, 99, 1)?.tag).toBe('b');
  });
  it('falls back to the first source when the index is out of range', () => {
    expect(selectCaptureSource(sources, 99, -1)?.tag).toBe('a');
    expect(selectCaptureSource(sources, 99, 5)?.tag).toBe('a');
  });
  it('ignores empty display_id values when matching by id', () => {
    // targetId 0 stringifies to "0"; the empty-string source must not match it.
    expect(selectCaptureSource(sources, 0, 2)?.tag).toBe('c');
  });
});

describe('fitWithinLongEdge', () => {
  it('returns the input unchanged when already within the limit', () => {
    expect(fitWithinLongEdge(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
  it('returns the input unchanged when exactly at the limit', () => {
    expect(fitWithinLongEdge(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });
  it('scales a landscape frame down by its width', () => {
    expect(fitWithinLongEdge(2880, 1800, 1280)).toEqual({ width: 1280, height: 800 });
  });
  it('scales a portrait frame down by its height', () => {
    expect(fitWithinLongEdge(1000, 2000, 1280)).toEqual({ width: 640, height: 1280 });
  });
  it('never collapses a tiny dimension below 1px', () => {
    expect(fitWithinLongEdge(1, 4000, 1280)).toEqual({ width: 1, height: 1280 });
  });
  it('returns the input unchanged for degenerate zero dimensions', () => {
    expect(fitWithinLongEdge(0, 0, 1280)).toEqual({ width: 0, height: 0 });
  });
});

describe('listDisplays', () => {
  it('marks the primary display', () => {
    getPrimaryDisplay.mockReturnValue(display(1));
    getAllDisplays.mockReturnValue([display(1), display(2)]);
    const control = createDefaultDesktopControl({ runner: vi.fn(), platform: 'darwin' });
    const displays = control.listDisplays();
    expect(displays).toHaveLength(2);
    expect(displays[0]).toMatchObject({ id: 1, primary: true, scaleFactor: 2 });
    expect(displays[1]).toMatchObject({ id: 2, primary: false });
  });
});

describe('toDriverPoint', () => {
  it('uses Electron DIP conversion on Windows so mixed-DPI physical origins stay correct', () => {
    dipToScreenPoint.mockReturnValue({ x: 2520.4, y: 675.6 });
    const control = createDefaultDesktopControl({ runner: vi.fn(), platform: 'win32' });

    expect(control.toDriverPoint({ x: 2160, y: 450 }, 1.5)).toEqual({ x: 2520, y: 676 });
    expect(dipToScreenPoint).toHaveBeenCalledWith({ x: 2160, y: 450 });
  });

  it('keeps macOS points logical and does not call Electron DIP conversion', () => {
    const control = createDefaultDesktopControl({ runner: vi.fn(), platform: 'darwin' });

    expect(control.toDriverPoint({ x: 720, y: 450 }, 2)).toEqual({ x: 720, y: 450 });
    expect(dipToScreenPoint).not.toHaveBeenCalled();
  });
});

describe('capture', () => {
  const control = () => createDefaultDesktopControl({ runner: vi.fn(), platform: 'darwin' });

  it('captures the primary display by default', async () => {
    getPrimaryDisplay.mockReturnValue(display(1));
    getAllDisplays.mockReturnValue([display(1)]);
    getSources.mockResolvedValue([fakeSource(1)]);
    const frame = await control().capture();
    expect(frame.displayId).toBe(1);
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(800);
    expect(frame.mimeType).toBe('image/jpeg');
    expect(frame.base64).toBe(Buffer.from('jpeg-bytes').toString('base64'));
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 800 },
    });
  });

  it('captures a specific display when displayId is provided', async () => {
    getAllDisplays.mockReturnValue([display(1), display(2)]);
    getSources.mockResolvedValue([fakeSource(2)]);
    const frame = await control().capture(2);
    expect(frame.displayId).toBe(2);
  });

  it('throws when the requested display is not found', async () => {
    getAllDisplays.mockReturnValue([display(1)]);
    await expect(control().capture(99)).rejects.toThrow('Display 99 not found');
  });

  it('falls back to the first source when no display_id matches', async () => {
    getPrimaryDisplay.mockReturnValue(display(1));
    getAllDisplays.mockReturnValue([display(1)]);
    getSources.mockResolvedValue([fakeSource(7)]);
    const frame = await control().capture();
    expect(frame.displayId).toBe(1);
  });

  it('selects the source at the target display index when ids are empty (Windows multi-monitor)', async () => {
    getAllDisplays.mockReturnValue([display(1), display(2)]);
    // Both sources report an empty display_id, as Windows commonly does; the second
    // display must map to the second source positionally, not fall back to the first.
    getSources.mockResolvedValue([markedSource('primary'), markedSource('secondary')]);
    const frame = await control().capture(2);
    expect(frame.displayId).toBe(2);
    expect(frame.base64).toBe(Buffer.from('secondary').toString('base64'));
  });

  it('throws when the capture is empty', async () => {
    getPrimaryDisplay.mockReturnValue(display(1));
    getAllDisplays.mockReturnValue([display(1)]);
    getSources.mockResolvedValue([fakeSource(1, true)]);
    await expect(control().capture()).rejects.toThrow('no image');
  });

  it('throws when there are no sources at all', async () => {
    getPrimaryDisplay.mockReturnValue(display(1));
    getAllDisplays.mockReturnValue([display(1)]);
    getSources.mockResolvedValue([]);
    await expect(control().capture()).rejects.toThrow('no image');
  });
});

describe('listWindows', () => {
  it('lists macOS apps and marks the frontmost', async () => {
    const runner: CommandRunner = vi.fn(async (_cmd, args) => {
      if (args.join(' ').includes('frontmost is true')) return 'Notes';
      return 'Safari, Notes';
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    const windows = await control.listWindows();
    expect(windows).toEqual([
      { appId: 'Safari', title: 'Safari', focused: false },
      { appId: 'Notes', title: 'Notes', focused: true },
    ]);
  });

  it('tolerates the frontmost query failing', async () => {
    const runner: CommandRunner = vi.fn(async (_cmd, args) => {
      if (args.join(' ').includes('frontmost is true')) throw new Error('no frontmost');
      return 'Safari';
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    const windows = await control.listWindows();
    expect(windows).toEqual([{ appId: 'Safari', title: 'Safari', focused: false }]);
  });

  it('parses Windows process output including focus state and pipes in titles', async () => {
    const runner: CommandRunner = vi.fn(async () => 'chrome\tTab A\tTrue\r\ncode\ta|b\tFalse\r\nbare\t\tFalse\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    const windows = await control.listWindows();
    expect(windows).toEqual([
      { appId: 'chrome', title: 'Tab A', focused: true },
      { appId: 'code', title: 'a|b', focused: false },
      { appId: 'bare', title: 'bare', focused: false },
    ]);
    expect(runner).toHaveBeenCalledWith('powershell', [
      '-NoProfile',
      '-Command',
      expect.stringContaining('GetForegroundWindow'),
    ]);
  });

  it('defaults Windows focus to false if the probe field is missing', async () => {
    const runner: CommandRunner = vi.fn(async () => 'legacy\tLegacy title\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });

    await expect(control.listWindows()).resolves.toEqual([
      { appId: 'legacy', title: 'Legacy title', focused: false },
    ]);
  });

  it('returns an empty list on unsupported platforms', async () => {
    const control = createDefaultDesktopControl({ runner: vi.fn(), platform: 'linux' });
    expect(await control.listWindows()).toEqual([]);
  });

  it('returns an empty list when the runner throws', async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error('boom');
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.listWindows()).toEqual([]);
  });
});

describe('getFrontmostApp', () => {
  it('returns the macOS frontmost process name', async () => {
    const runner: CommandRunner = vi.fn(async (_cmd, args) => {
      if (args.join(' ').includes('frontmost is true')) return '  WeChat\n';
      return '';
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.getFrontmostApp()).toEqual({ name: 'WeChat', candidates: ['WeChat'] });
  });

  it('returns undefined when the macOS frontmost query is empty', async () => {
    const runner: CommandRunner = vi.fn(async () => '   ');
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.getFrontmostApp()).toBeUndefined();
  });

  it('returns undefined when the macOS frontmost query throws', async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error('no permission');
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.getFrontmostApp()).toBeUndefined();
  });

  it('returns the Windows friendly name plus process name as candidates', async () => {
    const runner: CommandRunner = vi.fn(async () => 'msedge\tMicrosoft Edge\tInbox - Outlook\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.getFrontmostApp()).toEqual({
      name: 'Microsoft Edge',
      candidates: ['Microsoft Edge', 'msedge'],
    });
  });

  it('falls back to the Windows process name when no friendly name is reported', async () => {
    const runner: CommandRunner = vi.fn(async () => 'WeChat\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.getFrontmostApp()).toEqual({ name: 'WeChat', candidates: ['WeChat'] });
  });

  it('returns undefined when the Windows query throws', async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error('boom');
    });
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.getFrontmostApp()).toBeUndefined();
  });

  it('returns undefined on unsupported platforms', async () => {
    const control = createDefaultDesktopControl({ runner: vi.fn(), platform: 'linux' });
    expect(await control.getFrontmostApp()).toBeUndefined();
  });
});

describe('focusWindow', () => {
  it('activates a macOS app', async () => {
    const runner = vi.fn(async () => '');
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.focusWindow({ appId: 'Safari' })).toBe(true);
    expect(runner).toHaveBeenCalledWith('osascript', ['-e', 'tell application "Safari" to activate']);
  });

  it('escapes a malicious macOS app name so AppleScript cannot be injected', async () => {
    const runner = vi.fn(async (_cmd: string, _args: string[]) => '');
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    await control.focusWindow({ appId: 'Safari"\ntell application "Finder" to quit' });
    const script = runner.mock.calls[0][1][1];
    // The injected quote/newline must be escaped, keeping a single activate statement.
    expect(script).toBe('tell application "Safari\\"\\ntell application \\"Finder\\" to quit" to activate');
    expect(script).not.toContain('" to activate\ntell');
  });

  it('activates a Windows app and reports success only when the script returns OK', async () => {
    const runner = vi.fn(async (_cmd: string, _args: string[]) => 'OK\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.focusWindow({ title: 'Notepad' })).toBe(true);
    const [cmd, args] = runner.mock.calls[0];
    expect(cmd).toBe('powershell');
    expect(args[2]).toContain("$q='Notepad';");
    expect(args[2]).toContain('AppActivate($t.Id)');
  });

  it('matches the Windows window title as a literal substring, not a wildcard pattern', async () => {
    const runner = vi.fn(async (_cmd: string, _args: string[]) => 'OK\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.focusWindow({ title: 'Word [Protected View]' })).toBe(true);
    const script = runner.mock.calls[0][1][2];
    // A `-ilike '*...*'` would treat the brackets as a wildcard character class, so a
    // title like "Word [Protected View]" would match the wrong window or none at all.
    expect(script).not.toContain('-ilike');
    expect(script).toContain('.ToLower().Contains($q.ToLower())');
    // The raw bracketed title is still embedded as a safe single-quoted literal.
    expect(script).toContain("$q='Word [Protected View]';");
  });

  it('reports failure when the Windows focus script finds no matching window', async () => {
    const runner = vi.fn(async () => 'NONE\r\n');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.focusWindow({ appId: 'Ghost' })).toBe(false);
  });

  it('escapes single quotes in the Windows focus target', async () => {
    const runner = vi.fn(async (_cmd: string, _args: string[]) => 'OK');
    const control = createDefaultDesktopControl({ runner, platform: 'win32' });
    expect(await control.focusWindow({ appId: "Bob's App" })).toBe(true);
    const script = runner.mock.calls[0][1][2];
    expect(script).toContain("$q='Bob''s App';");
  });

  it('returns false on unsupported platforms', async () => {
    const control = createDefaultDesktopControl({ runner: vi.fn(async () => ''), platform: 'linux' });
    expect(await control.focusWindow({ appId: 'x' })).toBe(false);
  });

  it('returns false for an empty query without invoking the runner', async () => {
    const runner = vi.fn(async () => '');
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.focusWindow({})).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('returns false when the runner throws', async () => {
    const runner = vi.fn(async () => {
      throw new Error('nope');
    });
    const control = createDefaultDesktopControl({ runner, platform: 'darwin' });
    expect(await control.focusWindow({ appId: 'Safari' })).toBe(false);
  });
});

describe('defaultCommandRunner', () => {
  it('hides helper windows', () => {
    expect(DEFAULT_COMMAND_RUNNER_OPTIONS).toEqual({ timeout: 5000, windowsHide: true });
  });

  it('resolves stdout from a real process', async () => {
    const out = await defaultCommandRunner(process.execPath, ['-e', 'process.stdout.write("hi")']);
    expect(out).toBe('hi');
  });

  it('rejects when the process fails', async () => {
    await expect(
      defaultCommandRunner(process.execPath, ['-e', 'process.exit(3)']),
    ).rejects.toBeTruthy();
  });
});

describe('createDefaultDesktopControl defaults', () => {
  it('defaults runner and platform when omitted', () => {
    const control = createDefaultDesktopControl();
    expect(typeof control.listWindows).toBe('function');
    expect(typeof control.focusWindow).toBe('function');
  });
});

describe('foreground probe cleanup', () => {
  it('registers a will-quit cleanup of the probe DLL on Windows', () => {
    createDefaultDesktopControl({ runner: vi.fn(), platform: 'win32' });
    expect(appOnce).toHaveBeenCalledTimes(1);
    const [event, handler] = appOnce.mock.calls[0];
    expect(event).toBe('will-quit');
    // The registered handler unlinks the cached probe DLL.
    (handler as () => void)();
    expect(unlinkSyncSpy).toHaveBeenCalledTimes(1);
    expect(String(unlinkSyncSpy.mock.calls[0][0])).toMatch(/openkosmos-cu-fg-.*\.dll$/);
  });

  it('does not register a cleanup on non-Windows platforms', () => {
    createDefaultDesktopControl({ runner: vi.fn(), platform: 'darwin' });
    expect(appOnce).not.toHaveBeenCalled();
  });

  it('swallows unlink failures so a locked/missing DLL never throws on quit', () => {
    unlinkSyncSpy.mockImplementation(() => {
      throw new Error('EBUSY');
    });
    expect(() => cleanupForegroundProbe()).not.toThrow();
    expect(unlinkSyncSpy).toHaveBeenCalledTimes(1);
  });
});
