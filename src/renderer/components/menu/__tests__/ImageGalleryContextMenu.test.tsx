// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WithStore } from '@/atom';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockClampMenuToViewport = vi.hoisted(() => vi.fn());
const mockGetContextMenuPosition = vi.hoisted(() =>
  vi.fn().mockReturnValue({ top: 100, left: 200 }),
);

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  clampMenuToViewport: mockClampMenuToViewport,
  getContextMenuPosition: mockGetContextMenuPosition,
  CONTEXT_MENU_SIZE_PRESETS: {
    imageGalleryMenu: { estimatedWidth: 200, estimatedHeight: 150 },
  },
  ContextMenuPosition: {},
}));

vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// lucide-react icons
vi.mock('lucide-react', () => ({
  Copy: () => <svg data-testid="copy-icon" />,
  Download: () => <svg data-testid="download-icon" />,
}));

// ── imports (after mocks) ──────────────────────────────────────────────────────
import { ImageGalleryMenuAtom } from '../ImageGalleryContextMenu';
import ImageGalleryContextMenuDefault from '../ImageGalleryContextMenu';

// ── helpers ────────────────────────────────────────────────────────────────────
function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function makeImageData(overrides?: Partial<{ url: string; alt: string; index: number }>) {
  return { url: 'https://example.com/image.png', alt: 'test image', index: 0, ...overrides };
}

function makeGallery() {
  return [
    { id: 'img-0', url: 'https://example.com/a.png', alt: 'A' },
    { id: 'img-1', url: 'https://example.com/b.png', alt: 'B' },
  ];
}

// ── ImageGalleryMenuAtom ───────────────────────────────────────────────────────
describe('ImageGalleryMenuAtom', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts closed', () => {
    const { result } = (() => {
      let state: any;
      const Probe = () => {
        const [s] = ImageGalleryMenuAtom.use();
        state = s;
        return null;
      };
      wrap(<Probe />);
      return { result: state };
    })();
    expect(result.isOpen).toBe(false);
    expect(result.imageData).toBeNull();
  });

  it('open() sets isOpen=true and stores imageData', async () => {
    let actions: any;
    let state: any;
    const Probe = () => {
      const [s, a] = ImageGalleryMenuAtom.use();
      state = s;
      actions = a;
      return null;
    };
    wrap(<Probe />);

    const fakeEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 50,
      clientY: 80,
    } as unknown as React.MouseEvent;

    await act(async () => {
      actions.open(fakeEvent, makeImageData(), makeGallery(), 1);
    });

    expect(state.isOpen).toBe(true);
    expect(state.imageData).toMatchObject({ url: 'https://example.com/image.png' });
    expect(state.galleryImages).toHaveLength(2);
    expect(state.initialIndex).toBe(1);
  });

  it('open() works without optional gallery/initialIndex args', async () => {
    let actions: any;
    let state: any;
    const Probe = () => {
      const [s, a] = ImageGalleryMenuAtom.use();
      state = s;
      actions = a;
      return null;
    };
    wrap(<Probe />);

    const fakeEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 0,
      clientY: 0,
    } as unknown as React.MouseEvent;

    await act(async () => {
      actions.open(fakeEvent, makeImageData());
    });

    expect(state.isOpen).toBe(true);
    expect(state.galleryImages).toBeNull();
    expect(state.initialIndex).toBe(0);
  });

  it('close() resets to zero state', async () => {
    let actions: any;
    let state: any;
    const Probe = () => {
      const [s, a] = ImageGalleryMenuAtom.use();
      state = s;
      actions = a;
      return null;
    };
    wrap(<Probe />);

    const fakeEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 0,
      clientY: 0,
    } as unknown as React.MouseEvent;

    await act(async () => {
      actions.open(fakeEvent, makeImageData());
    });
    expect(state.isOpen).toBe(true);

    await act(async () => {
      actions.close();
    });
    expect(state.isOpen).toBe(false);
    expect(state.imageData).toBeNull();
  });
});

// ── Default export (wrapper component) ────────────────────────────────────────
describe('ImageGalleryContextMenu default export (wrapper)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing when atom is closed', () => {
    const { container } = wrap(<ImageGalleryContextMenuDefault />);
    expect(container.querySelector('.image-gallery-context-menu')).toBeNull();
  });

  it('renders menu when atom is open', async () => {
    let actions: any;
    const OpenController = () => {
      const [, a] = ImageGalleryMenuAtom.use();
      actions = a;
      return null;
    };

    const { container } = wrap(
      <>
        <OpenController />
        <ImageGalleryContextMenuDefault />
      </>,
    );

    const fakeEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
    } as unknown as React.MouseEvent;

    await act(async () => {
      actions.open(fakeEvent, makeImageData(), makeGallery(), 0);
    });

    expect(container.querySelector('.image-gallery-context-menu')).toBeTruthy();
    expect(screen.getByText('View image')).toBeTruthy();
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Save as')).toBeTruthy();
  });
});

// ── Inner component interactions ───────────────────────────────────────────────
describe('ImageGalleryContextMenu inner component', () => {
  let actions: any;

  async function renderOpenMenu(imageData = makeImageData(), gallery = makeGallery(), idx = 0) {
    const OpenController = () => {
      const [, a] = ImageGalleryMenuAtom.use();
      actions = a;
      return null;
    };
    const result = wrap(
      <>
        <OpenController />
        <ImageGalleryContextMenuDefault />
      </>,
    );

    const fakeEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
    } as unknown as React.MouseEvent;

    await act(async () => {
      actions.open(fakeEvent, imageData, gallery, idx);
    });

    return result;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure atom is closed before each test
    let closeActions: any;
    const Resetter = () => {
      const a = ImageGalleryMenuAtom.useChange();
      closeActions = a;
      return null;
    };
    const { unmount } = wrap(<Resetter />);
    if (closeActions) await act(async () => { closeActions.close(); });
    unmount();
  });

  it('clampMenuToViewport is called after layout effect', async () => {
    await renderOpenMenu();
    expect(mockClampMenuToViewport).toHaveBeenCalled();
  });

  it('"View image" dispatches imageViewer:open with gallery images', async () => {
    const events: CustomEvent[] = [];
    window.addEventListener('imageViewer:open', (e) => events.push(e as CustomEvent));

    await renderOpenMenu(makeImageData(), makeGallery(), 1);

    await act(async () => {
      fireEvent.click(screen.getByText('View image'));
    });

    expect(events).toHaveLength(1);
    expect(events[0].detail.images).toHaveLength(2);
    expect(events[0].detail.initialIndex).toBe(1);

    window.removeEventListener('imageViewer:open', () => {});
  });

  it('"View image" uses single image when no gallery', async () => {
    const events: CustomEvent[] = [];
    window.addEventListener('imageViewer:open', (e) => events.push(e as CustomEvent));

    const imageData = makeImageData({ url: 'https://example.com/solo.png', index: 3 });
    await renderOpenMenu(imageData, null as any, 0);

    await act(async () => {
      fireEvent.click(screen.getByText('View image'));
    });

    expect(events[0].detail.images).toHaveLength(1);
    expect(events[0].detail.images[0].url).toBe('https://example.com/solo.png');
    expect(events[0].detail.initialIndex).toBe(0);

    window.removeEventListener('imageViewer:open', () => {});
  });

  it('"View image" closes the menu after dispatch', async () => {
    const { container } = await renderOpenMenu();

    await act(async () => {
      fireEvent.click(screen.getByText('View image'));
    });

    expect(container.querySelector('.image-gallery-context-menu')).toBeNull();
  });

  it('"Save as" creates a download link and closes the menu', async () => {
    const { container } = await renderOpenMenu();

    const createdLinks: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement;
    document.createElement = function (tag: string, ...args: any[]) {
      const el = origCreateElement.call(document, tag, ...args);
      if (tag === 'a') {
        el.click = vi.fn();
        createdLinks.push(el as HTMLAnchorElement);
      }
      return el;
    };
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => el);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => el);

    await act(async () => {
      fireEvent.click(screen.getByText('Save as'));
    });

    document.createElement = origCreateElement;
    appendSpy.mockRestore();
    removeSpy.mockRestore();

    expect(createdLinks.length).toBeGreaterThan(0);
    expect(container.querySelector('.image-gallery-context-menu')).toBeNull();
  });

  it('"Save as" uses alt as filename when alt is provided', async () => {
    const imageData = makeImageData({ alt: 'my-image', index: 0 });
    const { container } = await renderOpenMenu(imageData);

    const capturedLinks: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement;
    document.createElement = function (tag: string, ...args: any[]) {
      const el = origCreateElement.call(document, tag, ...args);
      if (tag === 'a') {
        el.click = vi.fn();
        capturedLinks.push(el as HTMLAnchorElement);
      }
      return el;
    };

    vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => el);
    vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => el);

    await act(async () => {
      fireEvent.click(screen.getByText('Save as'));
    });

    document.createElement = origCreateElement;
    vi.restoreAllMocks();

    const link = capturedLinks[0];
    expect(link?.download).toBe('my-image');
  });

  it('"Save as" falls back to image-N filename when no alt', async () => {
    const imageData = makeImageData({ alt: undefined, index: 4 });
    const { container } = await renderOpenMenu(imageData);

    const capturedLinks: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement;
    document.createElement = function (tag: string, ...args: any[]) {
      const el = origCreateElement.call(document, tag, ...args);
      if (tag === 'a') {
        el.click = vi.fn();
        capturedLinks.push(el as HTMLAnchorElement);
      }
      return el;
    };

    vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => el);
    vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => el);

    await act(async () => {
      fireEvent.click(screen.getByText('Save as'));
    });

    document.createElement = origCreateElement;
    vi.restoreAllMocks();

    const link = capturedLinks[0];
    expect(link?.download).toBe('image-5');
  });

  it('"Copy" closes the menu (clipboard path tested via no-clipboard fallback)', async () => {
    // Set clipboard to undefined so the early-out path is hit, menu still closes
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { container } = await renderOpenMenu();

    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.querySelector('.image-gallery-context-menu')).toBeNull();
  });

  it('"Copy" handles missing ClipboardItem gracefully', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: { write: vi.fn() },
    });
    const origClipboardItem = (window as any).ClipboardItem;
    (window as any).ClipboardItem = undefined;

    const { container } = await renderOpenMenu();

    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.querySelector('.image-gallery-context-menu')).toBeNull();
    (window as any).ClipboardItem = origClipboardItem;
  });

  it('clicking the menu container stops propagation (does not close)', async () => {
    const { container } = await renderOpenMenu();
    const menu = container.querySelector('.image-gallery-context-menu') as HTMLElement;

    // Click inside the menu — should NOT close it (stopPropagation is called)
    fireEvent.click(menu);
    expect(container.querySelector('.image-gallery-context-menu')).toBeTruthy();
  });
});
