import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { atom } from '@/atom';
import '../../styles/OverlayImageViewer.css';
import { createLogger } from '../../lib/utilities/logger';
import { useI18n } from '../../lib/i18n/useI18n';
const logger = createLogger('[OverlayImageViewer]');

interface ImageItem {
  id: string;
  url: string;
  alt?: string;
}

interface State {
  isOpen: boolean;
  images: ImageItem[];
  initialIndex: number;
}

const zeroState: State = {
  isOpen: false,
  images: [],
  initialIndex: 0,
};

export const ImageViewerAtom = atom(zeroState, (_get, set) => {
  function open(images: ImageItem[], initialIndex: number) {
    set({ isOpen: true, images, initialIndex });
  }

  function close() {
    set(zeroState);
  }

  return { open, close };
});

export const OverlayImageViewer: React.FC = () => {
  const { t } = useI18n();
  const [state, actions] = ImageViewerAtom.use();
  const { isOpen, images, initialIndex } = state;

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isImageLoading, setIsImageLoading] = useState(true);
  // Tracks whether the current image's <img> emitted an error. Without this, a
  // failed load leaves the spinner up forever because only onLoad clears it.
  const [hasImageError, setHasImageError] = useState(false);

  // Listen for imageViewer:open custom events
  useEffect(() => {
    const handleOpenImageViewer = (event: CustomEvent) => {
      const { images, initialIndex } = event.detail;
      actions.open(images, initialIndex);
    };

    window.addEventListener(
      'imageViewer:open',
      handleOpenImageViewer as EventListener,
    );

    return () => {
      window.removeEventListener(
        'imageViewer:open',
        handleOpenImageViewer as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsImageLoading(true);
      setHasImageError(false);
    }
  }, [isOpen, initialIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          actions.close();
          break;
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, images.length]);

  // Prevent background scrolling
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsImageLoading(true);
      setHasImageError(false);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsImageLoading(true);
      setHasImageError(false);
    }
  }, [currentIndex, images.length]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Close only when clicking the background (not the image)
    if (e.target === e.currentTarget) {
      actions.close();
    }
  }, []);

  const handleImageLoad = useCallback(() => {
    setIsImageLoading(false);
  }, []);

  // Clear the loading spinner and surface an error state when the image fails to
  // load (e.g. a deleted file or a malformed URL). Without this the spinner would
  // hang indefinitely since only onLoad clears isImageLoading.
  const handleImageError = useCallback(() => {
    setIsImageLoading(false);
    setHasImageError(true);
  }, []);

  // Save image to local disk
  const handleSaveImage = useCallback(async () => {
    const currentImage = images[currentIndex];
    if (!currentImage) return;

    try {
      // Create a temporary <a> tag to trigger download
      const link = document.createElement('a');
      link.href = currentImage.url;

      // Set download filename
      const fileName = currentImage.alt || `image-${currentIndex + 1}`;
      link.download = fileName;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      logger.error('Failed to save image:', error);
    }
  }, [currentIndex, images]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const currentImage = images[currentIndex];

  // 🔥 Fix: guard against invalid image data
  if (!currentImage || !currentImage.url) {
    logger.error('🚨 [OverlayImageViewer] Current image is invalid:', { currentIndex, currentImage });
    return (
      <div className="image-viewer-overlay" onClick={actions.close}>
        <div className="image-viewer-content">
          <div className="image-viewer-error">
            <p>{t('viewer.image.failed')}</p>
            <button onClick={actions.close}>{t('common.close')}</button>
          </div>
        </div>
      </div>
    );
  }

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  return (
    <div className="image-viewer-overlay" onClick={handleOverlayClick}>
      {/* Toolbar buttons */}
      <div className="image-viewer-toolbar">
        {/* Save button */}
        <button
          className="image-viewer-tool-btn"
          onClick={handleSaveImage}
          aria-label={t('viewer.image.save')}
          title={t('viewer.image.save')}
        >
          <Download size={20} />
        </button>

        {/* Close button */}
        <button
          className="image-viewer-tool-btn image-viewer-close"
          onClick={actions.close}
          aria-label={t('viewer.image.closeViewer')}
          title={t('common.close')}
        >
          <X size={20} />
        </button>
      </div>

      {/* Left arrow */}
      {canGoPrev && (
        <button
          className="image-viewer-nav image-viewer-nav-prev"
          onClick={handlePrevious}
          aria-label={t('viewer.image.previous')}
        >
          <ChevronLeft size={48} />
        </button>
      )}

      {/* Image container */}
      <div className="image-viewer-content">
        {isImageLoading && !hasImageError && (
          <div className="image-viewer-loading">
            <div className="loading-spinner-large">
              <div className="spinner-circle-large"></div>
            </div>
            <div className="loading-text">{t('viewer.loading')}</div>
          </div>
        )}
        {hasImageError ? (
          <div className="image-viewer-error">
            <p>{t('viewer.image.failed')}</p>
            <button onClick={actions.close}>{t('common.close')}</button>
          </div>
        ) : (
          <img
            src={currentImage.url}
            alt={currentImage.alt || t('viewer.image.alt', { index: currentIndex + 1 })}
            className="image-viewer-image"
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{ display: isImageLoading ? 'none' : 'block' }}
          />
        )}
        {currentImage.alt && !isImageLoading && !hasImageError && (
          <div className="image-viewer-caption">
            {currentImage.alt}
          </div>
        )}
      </div>

      {/* Right arrow */}
      {canGoNext && (
        <button
          className="image-viewer-nav image-viewer-nav-next"
          onClick={handleNext}
          aria-label={t('viewer.image.next')}
        >
          <ChevronRight size={48} />
        </button>
      )}

      {/* Thumbnail indicator */}
      {images.length > 1 && (
        <div className="image-viewer-thumbnails">
          <div className="thumbnails-container">
            {images.map((img, index) => (
              <button
                key={img.id}
                className={`thumbnail-item ${index === currentIndex ? 'active' : ''}`}
                onClick={() => {
                  setCurrentIndex(index);
                  setIsImageLoading(true);
                  setHasImageError(false);
                }}
                aria-label={t('viewer.image.view', { index: index + 1 })}
              >
                <img
                  src={img.url}
                  alt={img.alt || t('viewer.image.thumbnail', { index: index + 1 })}
                  className="thumbnail-image"
                />
                {index === currentIndex && (
                  <div className="thumbnail-active-indicator" />
                )}
              </button>
            ))}
          </div>
          <div className="image-viewer-counter">
            {currentIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
};