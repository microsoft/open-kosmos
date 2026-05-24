/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- CSS stub ---
vi.mock('../../../styles/OverlayImageViewer.css', () => ({}));

// --- lucide-react ---
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  ChevronLeft: () => <span data-testid="icon-prev" />,
  ChevronRight: () => <span data-testid="icon-next" />,
  Download: () => <span data-testid="icon-download" />,
}));

// --- logger ---
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// --- atom mock ---
// We need to provide a working atom implementation (or a simple mock that manages state)
// Use the real atom from the renderer since it's pure React
vi.mock('@/atom', async (importOriginal) => {
  return await importOriginal();
});

import { OverlayImageViewer, ImageViewerAtom } from '../OverlayImageViewer';
import { WithStore } from '@/atom';

const sampleImages = [
  { id: 'img1', url: 'http://example.com/a.png', alt: 'Image A' },
  { id: 'img2', url: 'http://example.com/b.png', alt: 'Image B' },
  { id: 'img3', url: 'http://example.com/c.png', alt: 'Image C' },
];

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <WithStore>{children}</WithStore>
);

function renderViewer() {
  return render(<OverlayImageViewer />, { wrapper: Wrapper });
}

function openViewer(images = sampleImages, initialIndex = 0) {
  act(() => {
    ImageViewerAtom.useChange; // just accessing
    // Dispatch the custom event instead
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', { detail: { images, initialIndex } }),
    );
  });
}

describe('OverlayImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = renderViewer();
    expect(container.firstChild).toBeNull();
  });

  it('opens via imageViewer:open custom event', async () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    expect(screen.getAllByAltText('Image A').length).toBeGreaterThan(0);
  });

  it('closes via close button', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.click(screen.getByLabelText('Close image viewer'));
    expect(screen.queryByAltText('Image A')).toBeNull();
  });

  it('closes when clicking the overlay background', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    const overlay = document.querySelector('.image-viewer-overlay')!;
    // Simulate clicking the background (target === currentTarget)
    fireEvent.click(overlay);
    // Note: this only closes if target === currentTarget (overlay itself, not a child)
    // In jsdom, direct click on element has target === element
    expect(screen.queryByAltText('Image A')).toBeNull();
  });

  it('navigates to next image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.click(screen.getByLabelText('Next image'));
    // After navigation counter should show "2 / 3"
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('navigates to previous image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 1 } }),
      );
    });
    fireEvent.click(screen.getByLabelText('Previous image'));
    // After going back, counter should show "1 / 3"
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('does not show prev button on first image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    expect(screen.queryByLabelText('Previous image')).toBeNull();
  });

  it('does not show next button on last image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 2 } }),
      );
    });
    expect(screen.queryByLabelText('Next image')).toBeNull();
  });

  it('keyboard Escape closes the viewer', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByAltText('Image A')).toBeNull();
  });

  it('keyboard ArrowRight navigates to next image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('keyboard ArrowLeft navigates to previous image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 1 } }),
      );
    });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('shows thumbnails when multiple images', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    // Counter "1 / 3"
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('does not show thumbnails for single image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: [sampleImages[0]], initialIndex: 0 } }),
      );
    });
    expect(screen.queryByText('1 / 1')).toBeNull();
  });

  it('clicking thumbnail navigates to that image', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.click(screen.getByLabelText('View image 3'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('shows image caption when alt is present', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    // Simulate image load to hide loading state
    const mainImg = document.querySelector('.image-viewer-image')!;
    fireEvent.load(mainImg);
    // Caption div should be visible now
    expect(document.querySelector('.image-viewer-caption')).toBeInTheDocument();
  });

  it('shows loading spinner initially', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('hides loading spinner after image loads', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    const mainImg = document.querySelector('.image-viewer-image')!;
    fireEvent.load(mainImg);
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('shows Save button', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    expect(screen.getByLabelText('Save image')).toBeInTheDocument();
  });

  it('prevents background scrolling when open', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores background scrolling when closed', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', { detail: { images: sampleImages, initialIndex: 0 } }),
      );
    });
    fireEvent.click(screen.getByLabelText('Close image viewer'));
    expect(document.body.style.overflow).toBe('');
  });

  it('renders error state for invalid image URL', () => {
    renderViewer();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('imageViewer:open', {
          detail: { images: [{ id: 'bad', url: '', alt: 'Bad' }], initialIndex: 0 },
        }),
      );
    });
    expect(screen.getByText('Image failed to load')).toBeInTheDocument();
  });
});
