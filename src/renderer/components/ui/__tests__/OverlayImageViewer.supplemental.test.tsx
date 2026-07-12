// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { OverlayImageViewer, ImageViewerAtom } from '../OverlayImageViewer';
import { WithStore } from '@/atom';

const stableI18n = { t: (key: string) => key, language: 'en', setLanguage: vi.fn() };

vi.mock('@/lib/i18n/useI18n', () => ({ useI18n: () => stableI18n }));
vi.mock('../../../styles/OverlayImageViewer.css', () => ({}));
vi.mock('lucide-react', () => ({ X: () => <span />, ChevronLeft: () => <span />, ChevronRight: () => <span />, Download: () => <span /> }));
vi.mock('../../../lib/utilities/logger', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/atom', async (importOriginal) => await importOriginal());

const wrapper = ({ children }: { children: React.ReactNode }) => <WithStore>{children}</WithStore>;
const images = [
  { id: '1', url: 'https://example.com/a.png' },
  { id: '2', url: 'https://example.com/b.png' },
];

function open(initialIndex = 0, customImages = images) {
  act(() => {
    window.dispatchEvent(new CustomEvent('imageViewer:open', { detail: { images: customImages, initialIndex } }));
  });
}

describe('OverlayImageViewer supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the first image selected when ArrowLeft is pressed at the start', () => {
    render(<OverlayImageViewer />, { wrapper });
    open(0);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('keeps the last image selected when ArrowRight is pressed at the end', () => {
    render(<OverlayImageViewer />, { wrapper });
    open(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('uses translated fallback alt text for main images and thumbnails without captions', () => {
    render(<OverlayImageViewer />, { wrapper });
    open(0);
    const mainImage = document.querySelector('.image-viewer-image') as HTMLImageElement;
    expect(mainImage.alt).toBe('viewer.image.alt');
    const thumbnailImages = document.querySelectorAll('.thumbnail-image');
    expect((thumbnailImages[0] as HTMLImageElement).alt).toBe('viewer.image.thumbnail');
  });

  it('downloads unnamed images with a generated file name', async () => {
    render(<OverlayImageViewer />, { wrapper });
    open(0, [{ id: '1', url: 'https://example.com/a.png' }]);

    const appended: any[] = [];
    const removed: any[] = [];
    const realCreateElement = document.createElement.bind(document);
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as any;
      }
      return realCreateElement(tag);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: any) => { appended.push(node); return node; });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: any) => { removed.push(node); return node; });

    await userEvent.click(screen.getByLabelText('viewer.image.save'));

    expect(appended[0].download).toBe('image-1');
    expect(clickSpy).toHaveBeenCalled();
    expect(removed).toHaveLength(1);
  });
});
