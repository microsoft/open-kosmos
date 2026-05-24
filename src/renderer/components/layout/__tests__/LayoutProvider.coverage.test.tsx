/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for LayoutProvider.tsx
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { LayoutProvider, useLayout } from '../LayoutProvider';

function TestConsumer() {
  const layout = useLayout();
  return (
    <div>
      <span data-testid="minimal">{String(layout.isMinimalMode)}</span>
      <span data-testid="alwaysontop">{String(layout.isAlwaysOnTop)}</span>
      <button data-testid="toggle-minimal" onClick={layout.toggleMinimalMode}>Toggle Minimal</button>
      <button data-testid="set-minimal-true" onClick={() => layout.setMinimalMode(true)}>Set Minimal True</button>
      <button data-testid="set-minimal-false" onClick={() => layout.setMinimalMode(false)}>Set Minimal False</button>
      <button data-testid="toggle-aot" onClick={layout.toggleAlwaysOnTop}>Toggle AOT</button>
      <button data-testid="set-aot-true" onClick={() => layout.setAlwaysOnTop(true)}>Set AOT True</button>
    </div>
  );
}

function setupElectronAPI(opts: { setAlwaysOnTop?: (v: boolean) => Promise<boolean>; isAlwaysOnTop?: () => Promise<boolean> } = {}) {
  const setAlwaysOnTop = opts.setAlwaysOnTop ?? vi.fn().mockResolvedValue(true);
  const isAlwaysOnTop = opts.isAlwaysOnTop ?? vi.fn().mockResolvedValue(false);
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      window: { setAlwaysOnTop, isAlwaysOnTop },
    },
  });
  return { setAlwaysOnTop, isAlwaysOnTop };
}

describe('LayoutProvider', () => {
  beforeEach(() => {
    setupElectronAPI();
  });

  it('renders children', () => {
    render(
      <LayoutProvider>
        <div data-testid="child">hello</div>
      </LayoutProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('provides default layout state (not minimal, not always on top)', () => {
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    expect(screen.getByTestId('minimal').textContent).toBe('false');
    expect(screen.getByTestId('alwaysontop').textContent).toBe('false');
  });

  it('toggleMinimalMode toggles isMinimalMode', async () => {
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('toggle-minimal').click();
    });
    expect(screen.getByTestId('minimal').textContent).toBe('true');
  });

  it('setMinimalMode(true) sets minimal mode', async () => {
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('set-minimal-true').click();
    });
    expect(screen.getByTestId('minimal').textContent).toBe('true');
  });

  it('setMinimalMode(false) unsets minimal mode', async () => {
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('set-minimal-true').click();
    });
    await act(async () => {
      screen.getByTestId('set-minimal-false').click();
    });
    expect(screen.getByTestId('minimal').textContent).toBe('false');
  });

  it('toggleAlwaysOnTop calls electronAPI', async () => {
    const { setAlwaysOnTop } = setupElectronAPI();
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('toggle-aot').click();
    });
    expect(setAlwaysOnTop).toHaveBeenCalled();
  });

  it('setAlwaysOnTop(true) calls electronAPI', async () => {
    const { setAlwaysOnTop } = setupElectronAPI();
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('set-aot-true').click();
    });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('initializes alwaysOnTop from electron on mount', async () => {
    setupElectronAPI({ isAlwaysOnTop: vi.fn().mockResolvedValue(true) });
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    // After mount, isAlwaysOnTop should have been called
    await act(async () => {});
    // State reflects the returned value
    expect(screen.getByTestId('alwaysontop').textContent).toBe('true');
  });

  it('handles missing electronAPI gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', { writable: true, configurable: true, value: undefined });
    render(
      <LayoutProvider>
        <TestConsumer />
      </LayoutProvider>
    );
    await act(async () => {
      screen.getByTestId('toggle-aot').click();
    });
    // Should not throw
    expect(screen.getByTestId('alwaysontop').textContent).toBe('false');
  });

  it('throws when useLayout is used outside LayoutProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useLayout must be used within a LayoutProvider');
    spy.mockRestore();
  });
});
