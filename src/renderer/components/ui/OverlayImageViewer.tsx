import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import '../../styles/OverlayImageViewer.css';

interface OverlayImageViewerProps {
  images: Array<{
    id: string;
    url: string;
    alt?: string;
  }>;
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

export const OverlayImageViewer: React.FC<OverlayImageViewerProps> = ({
  images,
  initialIndex,
  isOpen,
  onClose
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isImageLoading, setIsImageLoading] = useState(true);

  // Reset current index when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsImageLoading(true);
    }
  }, [isOpen, initialIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
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
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsImageLoading(true);
    }
  }, [currentIndex, images.length]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Only close when clicking background (not the image)
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleImageLoad = useCallback(() => {
    setIsImageLoading(false);
  }, []);

  // Save image to local
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
      console.error('Failed to save image:', error);
    }
  }, [currentIndex, images]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const currentImage = images[currentIndex];
  
  // 🔥 Fix: Guard against invalid image data
  if (!currentImage || !currentImage.url) {
    console.error('🚨 [OverlayImageViewer] Current image is invalid:', { currentIndex, currentImage });
    return (
      <div className="image-viewer-overlay" onClick={onClose}>
        <div className="image-viewer-content">
          <div className="image-viewer-error">
            <p>Failed to load image</p>
            <button onClick={onClose}>Close</button>
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
          aria-label="Save image"
          title="Save image"
        >
          <Download size={20} />
        </button>
        
        {/* Close button */}
        <button
          className="image-viewer-tool-btn image-viewer-close"
          onClick={onClose}
          aria-label="Close image viewer"
          title="Close"
        >
          <X size={20} />
        </button>
      </div>

      {/* Left arrow */}
      {canGoPrev && (
        <button
          className="image-viewer-nav image-viewer-nav-prev"
          onClick={handlePrevious}
          aria-label="Previous image"
        >
          <ChevronLeft size={48} />
        </button>
      )}

      {/* Image container */}
      <div className="image-viewer-content">
        {isImageLoading && (
          <div className="image-viewer-loading">
            <div className="loading-spinner-large">
              <div className="spinner-circle-large"></div>
            </div>
            <div className="loading-text">Loading...</div>
          </div>
        )}
        <img
          src={currentImage.url}
          alt={currentImage.alt || `Image ${currentIndex + 1}`}
          className="image-viewer-image"
          onLoad={handleImageLoad}
          style={{ display: isImageLoading ? 'none' : 'block' }}
        />
        {currentImage.alt && !isImageLoading && (
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
          aria-label="Next image"
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
                }}
                aria-label={`View image ${index + 1}`}
              >
                <img
                  src={img.url}
                  alt={img.alt || `Thumbnail ${index + 1}`}
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