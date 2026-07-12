// @ts-nocheck
/** @vitest-environment happy-dom */
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { WithStore } from '@/atom';

const mockClampMenuToViewport = vi.hoisted(() => vi.fn());
const mockGetContextMenuPosition = vi.hoisted(() => vi.fn(() => ({ top: 24, left: 36 })));
const mockLogger = vi.hoisted(() => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  clampMenuToViewport: mockClampMenuToViewport,
  CONTEXT_MENU_SIZE_PRESETS: { imageGalleryMenu: { estimatedWidth: 180, estimatedHeight: 120 } },
  getContextMenuPosition: mockGetContextMenuPosition,
}));

vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'chat.image.view': 'View image',
      'common.copy': 'Copy',
      'common.saveAs': 'Save as',
    }[key] ?? key),
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('lucide-react', () => ({
  Copy: () => <svg data-testid="copy-icon" />,
  Download: () => <svg data-testid="download-icon" />,
}));

import ImageGalleryContextMenu, { ImageGalleryMenuAtom } from '../ImageGalleryContextMenu';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function Controller() {
  const [, actions] = ImageGalleryMenuAtom.use();
  return (
    <button
      data-testid="open-menu"
      onClick={(event) =>
        actions.open(
          event as unknown as React.MouseEvent,
          { url: 'https://example.com/image.png', alt: 'sample-image', index: 2 },
          [{ id: 'image-1', url: 'https://example.com/image.png', alt: 'sample-image' }],
          0,
        )
      }
      type="button"
    >
      open
    </button>
  );
}

describe('ImageGalleryContextMenu supplemental coverage', () => {
  const originalCreateElement = document.createElement.bind(document);
  const originalImage = globalThis.Image;
  const originalClipboardItem = globalThis.ClipboardItem;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: { write: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    globalThis.Image = originalImage;
    globalThis.ClipboardItem = originalClipboardItem;
  });

  function openMenu() {
    wrap(
      <>
        <Controller />
        <ImageGalleryContextMenu />
      </>,
    );
    fireEvent.click(screen.getByTestId('open-menu'));
  }

  it('copies a converted PNG blob to the clipboard successfully', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });

    document.createElement = vi.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          getContext: vi.fn(() => ({ drawImage })),
          toBlob,
          width: 0,
          height: 0,
        } as any;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    class MockImage {
      width = 320;
      height = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }

    class MockClipboardItem {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }

    globalThis.Image = MockImage as any;
    globalThis.ClipboardItem = MockClipboardItem as any;

    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    });

    await waitFor(() => {
      expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    });

    const [clipboardItems] = (navigator.clipboard.write as any).mock.calls[0];
    expect(clipboardItems[0]).toBeInstanceOf(MockClipboardItem);
    expect(drawImage).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('handles a missing ClipboardItem implementation gracefully', async () => {
    globalThis.ClipboardItem = undefined as any;

    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    });

    await waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalled();
    });
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('treats an empty PNG blob as an error and closes the menu', async () => {
    document.createElement = vi.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          getContext: vi.fn(() => ({ drawImage: vi.fn() })),
          toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([], { type: 'image/png' })),
          width: 0,
          height: 0,
        } as any;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    class MockImage {
      width = 320;
      height = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }

    globalThis.Image = MockImage as any;
    globalThis.ClipboardItem = class {
      constructor(_items: Record<string, Blob>) {}
    } as any;

    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    });

    await waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalled();
    });
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
