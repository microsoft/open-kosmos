import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();
const mockBuildFromTemplate = vi.fn();
const mockPopup = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
  },
  Menu: {
    buildFromTemplate: (...args: any[]) => {
      mockBuildFromTemplate(...args);
      return { popup: mockPopup };
    },
  },
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

function makeWindow(overrides: Record<string, any> = {}) {
  return {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    isAlwaysOnTop: vi.fn(() => false),
    setSize: vi.fn(),
    center: vi.fn(),
    getSize: vi.fn(() => [1200, 800]),
    setMinimumSize: vi.fn(),
    setMaximumSize: vi.fn(),
    getMinimumSize: vi.fn(() => [800, 600]),
    getMaximumSize: vi.fn(() => [0, 0]),
    ...overrides,
  };
}

describe('startup/ipc/window', () => {
  let mockCtx: any;
  let mainWindow: ReturnType<typeof makeWindow>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mainWindow = makeWindow();
    mockCtx = {
      mainWindow,
      stepWindowZoomLevel: vi.fn().mockResolvedValue(1.5),
      resetWindowZoomLevel: vi.fn().mockResolvedValue(1.0),
      getPersistedWindowZoomLevel: vi.fn().mockResolvedValue(1.0),
      applyWindowZoomLevel: vi.fn().mockResolvedValue(1.0),
      getMenuTemplate: vi.fn(() => [{ label: 'File' }]),
    };

    const { default: registerWindowIPC } = await import('../window');
    registerWindowIPC(mockCtx);
  });

  // --- Basic window state ---

  it('window:minimize calls mainWindow.minimize', () => {
    getHandler('window:minimize')();
    expect(mainWindow.minimize).toHaveBeenCalled();
  });

  it('window:maximize calls mainWindow.maximize', () => {
    getHandler('window:maximize')();
    expect(mainWindow.maximize).toHaveBeenCalled();
  });

  it('window:unmaximize calls mainWindow.unmaximize', () => {
    getHandler('window:unmaximize')();
    expect(mainWindow.unmaximize).toHaveBeenCalled();
  });

  it('window:close calls mainWindow.close', () => {
    getHandler('window:close')();
    expect(mainWindow.close).toHaveBeenCalled();
  });

  it('window:isMaximized returns false when not maximized', () => {
    mainWindow.isMaximized.mockReturnValue(false);
    expect(getHandler('window:isMaximized')()).toBe(false);
  });

  it('window:isMaximized returns true when maximized', () => {
    mainWindow.isMaximized.mockReturnValue(true);
    expect(getHandler('window:isMaximized')()).toBe(true);
  });

  it('window:isMaximized returns false when no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:isMaximized')()).toBe(false);
  });

  it('window:isFullScreen returns window value', () => {
    mainWindow.isFullScreen.mockReturnValue(true);
    expect(getHandler('window:isFullScreen')()).toBe(true);
  });

  // --- Zoom ---

  it('window:zoomIn calls stepWindowZoomLevel(+0.5)', async () => {
    const result = await getHandler('window:zoomIn')();
    expect(mockCtx.stepWindowZoomLevel).toHaveBeenCalledWith(0.5);
    expect(result).toBe(1.5);
  });

  it('window:zoomOut calls stepWindowZoomLevel(-0.5)', async () => {
    const result = await getHandler('window:zoomOut')();
    expect(mockCtx.stepWindowZoomLevel).toHaveBeenCalledWith(-0.5);
  });

  it('window:resetZoom calls resetWindowZoomLevel', async () => {
    const result = await getHandler('window:resetZoom')();
    expect(mockCtx.resetWindowZoomLevel).toHaveBeenCalled();
    expect(result).toBe(1.0);
  });

  it('window:getZoomLevel syncs and returns zoom level', async () => {
    mockCtx.getPersistedWindowZoomLevel.mockResolvedValue(1.25);
    mockCtx.applyWindowZoomLevel.mockResolvedValue(1.25);
    const result = await getHandler('window:getZoomLevel')();
    expect(mockCtx.getPersistedWindowZoomLevel).toHaveBeenCalled();
    expect(mockCtx.applyWindowZoomLevel).toHaveBeenCalledWith(1.25);
    expect(result).toBe(1.25);
  });

  // --- App menu ---

  it('window:showAppMenu builds and shows menu', () => {
    const result = getHandler('window:showAppMenu')({}, 100, 200);
    expect(mockCtx.getMenuTemplate).toHaveBeenCalled();
    expect(mockBuildFromTemplate).toHaveBeenCalledWith([{ label: 'File' }]);
    expect(mockPopup).toHaveBeenCalledWith({ window: mainWindow });
    expect(result).toBe(true);
  });

  it('window:showAppMenu passes undefined window when no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    getHandler('window:showAppMenu')({}, 0, 0);
    expect(mockPopup).toHaveBeenCalledWith({ window: undefined });
  });

  // --- Always on top ---

  it('window:setAlwaysOnTop sets flag and returns true', () => {
    expect(getHandler('window:setAlwaysOnTop')({}, true)).toBe(true);
    expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
  });

  it('window:setAlwaysOnTop returns false with no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:setAlwaysOnTop')({}, true)).toBe(false);
  });

  it('window:isAlwaysOnTop returns window value', () => {
    mainWindow.isAlwaysOnTop.mockReturnValue(true);
    expect(getHandler('window:isAlwaysOnTop')()).toBe(true);
  });

  // --- Size ---

  it('window:setSize calls setSize and center, returns true', () => {
    expect(getHandler('window:setSize')({}, 800, 600)).toBe(true);
    expect(mainWindow.setSize).toHaveBeenCalledWith(800, 600);
    expect(mainWindow.center).toHaveBeenCalled();
  });

  it('window:setSize returns false with no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:setSize')({}, 800, 600)).toBe(false);
  });

  it('window:getSize returns dimensions from mainWindow', () => {
    mainWindow.getSize.mockReturnValue([1440, 900]);
    expect(getHandler('window:getSize')()).toEqual({ width: 1440, height: 900 });
  });

  it('window:getSize returns defaults when no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:getSize')()).toEqual({ width: 1200, height: 800 });
  });

  it('window:setMinSize sets minimum size and returns true', () => {
    expect(getHandler('window:setMinSize')({}, 400, 300)).toBe(true);
    expect(mainWindow.setMinimumSize).toHaveBeenCalledWith(400, 300);
  });

  it('window:setMaxSize sets maximum size and returns true', () => {
    expect(getHandler('window:setMaxSize')({}, 2560, 1440)).toBe(true);
    expect(mainWindow.setMaximumSize).toHaveBeenCalledWith(2560, 1440);
  });

  it('window:getMinSize returns minimum size', () => {
    mainWindow.getMinimumSize.mockReturnValue([640, 480]);
    expect(getHandler('window:getMinSize')()).toEqual({ width: 640, height: 480 });
  });

  it('window:getMinSize returns defaults when no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:getMinSize')()).toEqual({ width: 800, height: 600 });
  });

  it('window:getMaxSize returns maximum size', () => {
    mainWindow.getMaximumSize.mockReturnValue([3840, 2160]);
    expect(getHandler('window:getMaxSize')()).toEqual({ width: 3840, height: 2160 });
  });

  it('window:getMaxSize returns zero defaults when no mainWindow', async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const ctx = { ...mockCtx, mainWindow: null };
    const { default: reg } = await import('../window');
    reg(ctx);
    expect(getHandler('window:getMaxSize')()).toEqual({ width: 0, height: 0 });
  });
});
