import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWindowFrames } from '../windowFrames';

// ── Mock node-screenshots ─────────────────────────────────────────────────────
vi.mock('node-screenshots', () => {
  return {
    Window: {
      all: vi.fn().mockReturnValue([]),
    },
  };
});

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDisplay(id: number, x: number, y: number, width: number, height: number, scaleFactor = 1): Electron.Display {
  return {
    id,
    bounds: { x, y, width, height },
    workArea: { x, y, width, height },
    workAreaSize: { width, height },
    size: { width, height },
    scaleFactor,
    rotation: 0,
    touchSupport: 'unknown',
    accelerometerSupport: 'unknown',
    colorDepth: 24,
    colorSpace: '',
    depthPerComponent: 8,
    detected: true,
    displayFrequency: 60,
    internal: false,
    label: `Display ${id}`,
    maximumCursorSize: { width: 32, height: 32 },
    monochrome: false,
    nativeOrigin: { x: 0, y: 0 },
  };
}

function makeWindow(opts: {
  id?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized?: boolean;
}) {
  return {
    id: vi.fn().mockReturnValue(opts.id ?? 1),
    x: vi.fn().mockReturnValue(opts.x),
    y: vi.fn().mockReturnValue(opts.y),
    width: vi.fn().mockReturnValue(opts.width),
    height: vi.fn().mockReturnValue(opts.height),
    isMinimized: vi.fn().mockReturnValue(opts.minimized ?? false),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getWindowFrames', () => {
  let mockAll: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('node-screenshots');
    mockAll = (mod.Window as any).all;
    mockAll.mockReturnValue([]);
  });

  it('returns an empty map when there are no displays', () => {
    const result = getWindowFrames([]);
    expect(result.size).toBe(0);
  });

  it('initialises an empty frames array for each display', () => {
    const displays = [makeDisplay(1, 0, 0, 1920, 1080)];
    const result = getWindowFrames(displays);
    expect(result.has(1)).toBe(true);
    expect(result.get(1)).toEqual([]);
  });

  it('skips minimized windows', () => {
    const displays = [makeDisplay(1, 0, 0, 1920, 1080)];
    mockAll.mockReturnValue([
      makeWindow({ id: 10, x: 100, y: 100, width: 800, height: 600, minimized: true }),
    ]);
    const result = getWindowFrames(displays);
    expect(result.get(1)).toEqual([]);
  });

  it('skips windows with width or height <= 1', () => {
    const displays = [makeDisplay(1, 0, 0, 1920, 1080)];
    mockAll.mockReturnValue([
      makeWindow({ id: 11, x: 0, y: 0, width: 1, height: 500 }),
      makeWindow({ id: 12, x: 0, y: 0, width: 500, height: 1 }),
      makeWindow({ id: 13, x: 0, y: 0, width: 0, height: 0 }),
    ]);
    const result = getWindowFrames(displays);
    expect(result.get(1)).toEqual([]);
  });

  it('skips windows whose centre point is outside all known displays', () => {
    const displays = [makeDisplay(1, 0, 0, 1920, 1080)];
    // Centre is at (3000, 3000) — outside display bounds
    mockAll.mockReturnValue([
      makeWindow({ id: 20, x: 2900, y: 2900, width: 200, height: 200 }),
    ]);
    const result = getWindowFrames(displays);
    expect(result.get(1)).toEqual([]);
  });

  it('assigns a visible window whose centre is inside display bounds', () => {
    const displays = [makeDisplay(1, 0, 0, 1920, 1080)];
    mockAll.mockReturnValue([
      makeWindow({ id: 30, x: 100, y: 100, width: 800, height: 600 }),
    ]);
    const result = getWindowFrames(displays);
    const frames = result.get(1)!;
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe(30);
  });

  it('converts window coordinates to display-relative physical pixels', () => {
    const scaleFactor = 2;
    const displays = [makeDisplay(1, 100, 200, 1920, 1080, scaleFactor)];
    // window at absolute (200, 400), so relative (100, 200) × scaleFactor = (200, 400)
    mockAll.mockReturnValue([
      makeWindow({ id: 40, x: 200, y: 400, width: 400, height: 300 }),
    ]);
    const result = getWindowFrames(displays);
    const frame = result.get(1)![0];
    expect(frame.x).toBe((200 - 100) * scaleFactor);
    expect(frame.y).toBe((400 - 200) * scaleFactor);
    expect(frame.width).toBe(400 * scaleFactor);
    expect(frame.height).toBe(300 * scaleFactor);
  });

  it('distributes windows to the correct display based on centre point', () => {
    const display1 = makeDisplay(1, 0, 0, 1920, 1080);
    const display2 = makeDisplay(2, 1920, 0, 1920, 1080);
    // window centre is at 2100, 540 — inside display2
    mockAll.mockReturnValue([
      makeWindow({ id: 50, x: 2000, y: 200, width: 200, height: 680 }),
    ]);
    const result = getWindowFrames([display1, display2]);
    expect(result.get(1)).toHaveLength(0);
    expect(result.get(2)).toHaveLength(1);
  });

  it('handles multiple windows on multiple displays', () => {
    const display1 = makeDisplay(1, 0, 0, 1920, 1080);
    const display2 = makeDisplay(2, 1920, 0, 1920, 1080);
    mockAll.mockReturnValue([
      makeWindow({ id: 60, x: 100, y: 100, width: 400, height: 400 }), // centre: 300,300 → display1
      makeWindow({ id: 61, x: 2000, y: 100, width: 400, height: 400 }), // centre: 2200,300 → display2
    ]);
    const result = getWindowFrames([display1, display2]);
    expect(result.get(1)).toHaveLength(1);
    expect(result.get(2)).toHaveLength(1);
  });
});
