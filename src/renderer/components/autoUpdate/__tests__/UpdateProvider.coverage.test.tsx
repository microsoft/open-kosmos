/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── hoisted mock variables ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const checkForUpdates = vi.fn().mockResolvedValue({ success: true });
  const downloadUpdate = vi.fn().mockResolvedValue(undefined);
  const skipVersion = vi.fn().mockResolvedValue(undefined);
  const quitAndInstall = vi.fn();
  const onUpdateEvent = vi.fn(() => vi.fn());
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));
  return {
    checkForUpdates,
    downloadUpdate,
    skipVersion,
    quitAndInstall,
    onUpdateEvent,
    createLogger,
  };
});

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: mocks.createLogger,
}));

vi.mock('../UpdateDialog', () => ({
  UpdateDialog: (props: Record<string, unknown>) => (
    <div data-testid="update-dialog" data-open={String(props.isOpen)}>
      {props.status as string}
      {props.error ? <span data-testid="dialog-error">{props.error as string}</span> : null}
    </div>
  ),
}));

vi.mock('../RestartingOverlay', () => ({
  RestartingOverlay: ({ isVisible }: { isVisible: boolean }) => (
    <div data-testid="restarting-overlay" data-visible={String(isVisible)} />
  ),
}));

// ── setup localStorage mock ───────────────────────────────────────────────────
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// ── helpers ───────────────────────────────────────────────────────────────────
type EventHandler = (data: unknown) => void;

class FakeEventBus {
  private handlers = new Map<string, EventHandler>();

  onUpdateEvent = vi.fn((event: string, handler: EventHandler) => {
    this.handlers.set(event, handler);
    return () => { this.handlers.delete(event); };
  });

  emit(event: string, data: unknown) {
    this.handlers.get(event)?.(data);
  }
}

let eventBus: FakeEventBus;

function setupElectronAPI() {
  eventBus = new FakeEventBus();
  (window as unknown as Record<string, unknown>).electronAPI = {
    update: {
      checkForUpdates: mocks.checkForUpdates,
      downloadUpdate: mocks.downloadUpdate,
      skipVersion: mocks.skipVersion,
      quitAndInstall: mocks.quitAndInstall,
      onUpdateEvent: eventBus.onUpdateEvent,
    },
  };
}

// ── import after mocks ────────────────────────────────────────────────────────
import { UpdateProvider, useUpdate } from '../UpdateProvider';

// Simple consumer component
const Consumer: React.FC = () => {
  const ctx = useUpdate();
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="dialog-open">{String(ctx.isDialogOpen)}</span>
      <span data-testid="check-phase">{ctx.checkPhase}</span>
      <button data-testid="btn-check" onClick={ctx.checkForUpdates}>check</button>
      <button data-testid="btn-silent" onClick={ctx.silentCheckForUpdates}>silent</button>
      <button data-testid="btn-download" onClick={ctx.downloadUpdate}>download</button>
      <button data-testid="btn-dismiss" onClick={ctx.dismissDialog}>dismiss</button>
      <button data-testid="btn-show" onClick={ctx.showUpdateDialog}>show</button>
      <button data-testid="btn-skip" onClick={() => ctx.skipVersion('1.0.0')}>skip</button>
      <button data-testid="btn-install" onClick={() => ctx.installUpdate('/path/to/file.exe')}>install</button>
    </div>
  );
};

// ── tests ─────────────────────────────────────────────────────────────────────
describe('UpdateProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupElectronAPI();
    try { localStorage.clear(); } catch { /* ignore if unavailable */ }
    localStorageMock.clear();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <UpdateProvider>
        <span data-testid="child">hello</span>
      </UpdateProvider>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('provides default context values', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );
    expect(screen.getByTestId('status').textContent).toBe('no-update');
    expect(screen.getByTestId('dialog-open').textContent).toBe('false');
    expect(screen.getByTestId('check-phase').textContent).toBe('idle');
  });

  it('throws when useUpdate is called outside provider', () => {
    const original = console.error;
    console.error = () => {};
    expect(() => render(<Consumer />)).toThrow('useUpdate must be used within UpdateProvider');
    console.error = original;
  });

  it('registers event listeners on mount', () => {
    render(<UpdateProvider><div /></UpdateProvider>);
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('updateAvailable', expect.any(Function));
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('updateNotAvailable', expect.any(Function));
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('downloadProgress', expect.any(Function));
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('updateDownloaded', expect.any(Function));
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('updateError', expect.any(Function));
    expect(eventBus.onUpdateEvent).toHaveBeenCalledWith('checkPhaseChanged', expect.any(Function));
  });

  it('handles updateAvailable event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('updateAvailable', {
        version: '2.0.0',
        releaseNotes: 'New features',
        releaseDate: new Date().toISOString(),
      });
    });

    expect(screen.getByTestId('status').textContent).toBe('available');
  });

  it('handles updateNotAvailable event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('updateNotAvailable', { version: '1.0.0' });
    });

    expect(screen.getByTestId('status').textContent).toBe('no-update');
    expect(screen.getByTestId('dialog-open').textContent).toBe('false');
  });

  it('handles downloadProgress event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('downloadProgress', {
        percent: 50,
        transferred: '50 MB',
        total: '100 MB',
        bytesPerSecond: '10 MB/s',
      });
    });

    expect(screen.getByTestId('status').textContent).toBe('downloading');
    expect(screen.getByTestId('check-phase').textContent).toBe('downloadingApp');
  });

  it('handles updateDownloaded event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('updateDownloaded', {
        filePath: '/tmp/update.exe',
        version: '2.0.0',
      });
    });

    expect(screen.getByTestId('status').textContent).toBe('downloaded');
  });

  it('handles updateError event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('updateError', 'Something went wrong');
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('handles updateError event with object error', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('updateError', { message: 'Object error message' });
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('handles checkPhaseChanged event', () => {
    render(
      <UpdateProvider>
        <Consumer />
      </UpdateProvider>
    );

    act(() => {
      eventBus.emit('checkPhaseChanged', { phase: 'checkingUpdater' });
    });

    expect(screen.getByTestId('check-phase').textContent).toBe('checkingUpdater');
  });

  it('handles updaterDownloadProgress event', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updaterDownloadProgress', {
        percent: 30,
        transferred: '30 MB',
        total: '100 MB',
      });
    });

    // No status change — just internal updaterProgress state
    expect(screen.getByTestId('status').textContent).toBe('no-update');
  });

  it('handles updaterDownloadFailed event', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updaterDownloadFailed', { error: 'Download failed' });
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('checkForUpdates opens dialog and calls API', async () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-check').click();
    });

    expect(mocks.checkForUpdates).toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('checking');
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('checkForUpdates handles API failure', async () => {
    mocks.checkForUpdates.mockResolvedValue({ success: false, error: 'API error' });
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-check').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('checkForUpdates handles thrown error', async () => {
    mocks.checkForUpdates.mockRejectedValue(new Error('Network failure'));
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-check').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('silentCheckForUpdates calls API with true', async () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-silent').click();
    });

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
  });

  it('downloadUpdate calls API', async () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-download').click();
    });

    expect(mocks.downloadUpdate).toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('downloading');
  });

  it('downloadUpdate handles error', async () => {
    mocks.downloadUpdate.mockRejectedValue(new Error('Download failed'));
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-download').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('dismissDialog closes dialog', async () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-check').click();
    });
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');

    act(() => {
      screen.getByTestId('btn-dismiss').click();
    });
    expect(screen.getByTestId('dialog-open').textContent).toBe('false');
  });

  it('showUpdateDialog opens dialog', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      screen.getByTestId('btn-show').click();
    });

    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('skipVersion calls API and resets status', async () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-skip').click();
    });

    expect(mocks.skipVersion).toHaveBeenCalledWith('1.0.0');
    expect(screen.getByTestId('status').textContent).toBe('no-update');
    expect(screen.getByTestId('dialog-open').textContent).toBe('false');
  });

  it('installUpdate does nothing when user cancels', async () => {
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updateDownloaded', { filePath: '/tmp/update.exe' });
    });

    await act(async () => {
      screen.getByTestId('btn-install').click();
    });

    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    window.confirm = originalConfirm;
  });

  it('installUpdate calls quitAndInstall when confirmed', async () => {
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updateDownloaded', { filePath: '/tmp/update.exe' });
    });

    await act(async () => {
      screen.getByTestId('btn-install').click();
    });

    expect(mocks.quitAndInstall).toHaveBeenCalled();
    window.confirm = originalConfirm;
  });

  it('runs silent startup check after 30 seconds', async () => {
    render(<UpdateProvider><div /></UpdateProvider>);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
  });

  it('does not run startup check when autoUpdateEnabled is false', async () => {
    localStorageMock.getItem.mockReturnValueOnce('false');
    render(<UpdateProvider><div /></UpdateProvider>);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });

  it('does nothing when electronAPI is unavailable', async () => {
    delete (window as unknown as Record<string, unknown>).electronAPI;

    render(<UpdateProvider><Consumer /></UpdateProvider>);

    await act(async () => {
      screen.getByTestId('btn-check').click();
    });

    // Should remain in default state
    expect(screen.getByTestId('status').textContent).toBe('no-update');
  });

  it('shows UpdateDialog component', () => {
    render(<UpdateProvider><div /></UpdateProvider>);
    expect(screen.getByTestId('update-dialog')).toBeTruthy();
  });

  it('shows RestartingOverlay component', () => {
    render(<UpdateProvider><div /></UpdateProvider>);
    const overlay = screen.getByTestId('restarting-overlay');
    expect(overlay.getAttribute('data-visible')).toBe('false');
  });

  it('handles updateAvailable with critical keyword in notes', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updateAvailable', {
        version: '2.0.0',
        releaseNotes: 'Security fix applied',
        releaseDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
    });

    expect(screen.getByTestId('status').textContent).toBe('available');
    // Dialog should open due to security keyword
    expect(screen.getByTestId('dialog-open').textContent).toBe('true');
  });

  it('handles updateDownloaded event with version info', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('updateDownloaded', {
        filePath: '/path/file.exe',
        version: '2.1.0',
        releaseNotes: 'notes',
        releaseDate: '2024-01-01',
      });
    });

    expect(screen.getByTestId('status').textContent).toBe('downloaded');
  });

  it('handles checkPhaseChanged with unknown phase', () => {
    render(<UpdateProvider><Consumer /></UpdateProvider>);

    act(() => {
      eventBus.emit('checkPhaseChanged', { phase: 'unknownPhase' });
    });

    // Should fall back to idle
    expect(screen.getByTestId('check-phase').textContent).toBe('idle');
  });
});
