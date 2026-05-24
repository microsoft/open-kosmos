/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Mock electronAPI
const mockResetZoom = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    platform: 'darwin',
    window: {
      resetZoom: mockResetZoom,
      zoomIn: mockZoomIn,
      zoomOut: mockZoomOut,
    },
  },
  writable: true,
  configurable: true,
});

import WindowZoomHotkeys from '../WindowZoomHotkeys';

function fireKeydown(opts: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', opts));
}

describe('WindowZoomHotkeys (mac)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      platform: 'darwin',
      window: {
        resetZoom: mockResetZoom,
        zoomIn: mockZoomIn,
        zoomOut: mockZoomOut,
      },
    };
  });

  it('renders null', () => {
    const { container } = render(React.createElement(WindowZoomHotkeys));
    expect(container.firstChild).toBeNull();
  });

  it('resets zoom on Cmd+0', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0', metaKey: true });
    expect(mockResetZoom).toHaveBeenCalled();
  });

  it('resets zoom on Cmd+Digit0', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ code: 'Digit0', metaKey: true });
    expect(mockResetZoom).toHaveBeenCalled();
  });

  it('zooms out on Cmd+-', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '-', metaKey: true });
    expect(mockZoomOut).toHaveBeenCalled();
  });

  it('zooms out on Cmd+Minus', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ code: 'Minus', metaKey: true });
    expect(mockZoomOut).toHaveBeenCalled();
  });

  it('zooms in on Cmd+=', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '=', metaKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('zooms in on Cmd++', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '+', metaKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('ignores event when no primary modifier', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0' });
    expect(mockResetZoom).not.toHaveBeenCalled();
  });

  it('ignores event with secondary modifier (Ctrl on Mac)', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0', metaKey: true, ctrlKey: true });
    expect(mockResetZoom).not.toHaveBeenCalled();
  });

  it('ignores event with altKey', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0', metaKey: true, altKey: true });
    expect(mockResetZoom).not.toHaveBeenCalled();
  });
});

describe('WindowZoomHotkeys (windows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      platform: 'win32',
      window: {
        resetZoom: mockResetZoom,
        zoomIn: mockZoomIn,
        zoomOut: mockZoomOut,
      },
    };
  });

  it('resets zoom on Ctrl+0 on Windows', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0', ctrlKey: true });
    expect(mockResetZoom).toHaveBeenCalled();
  });

  it('zooms in on Ctrl+= on Windows', () => {
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '=', ctrlKey: true });
    expect(mockZoomIn).toHaveBeenCalled();
  });
});

describe('WindowZoomHotkeys (no electronAPI)', () => {
  it('does nothing when electronAPI is absent', () => {
    (window as any).electronAPI = undefined;
    render(React.createElement(WindowZoomHotkeys));
    fireKeydown({ key: '0', metaKey: true });
    expect(mockResetZoom).not.toHaveBeenCalled();
  });
});
