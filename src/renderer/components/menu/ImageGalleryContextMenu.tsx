import React, { useLayoutEffect } from 'react';
import { Copy, Download } from 'lucide-react';

interface ImageGalleryContextMenuProps {
  imageGalleryMenuRef: React.RefObject<HTMLDivElement>;
  imageData: { url: string; alt?: string; index: number };
  galleryImages: Array<{ id: string; url: string; alt?: string }> | null;
  initialIndex: number;
  position: { top: number; left: number };
  onClose: () => void;
}

const ImageGalleryContextMenu: React.FC<ImageGalleryContextMenuProps> = ({
  imageGalleryMenuRef,
  imageData,
  galleryImages,
  initialIndex,
  position,
  onClose
}) => {
  // View image - open fullscreen viewer
  const handleViewImage = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    // If galleryImages exist, open full gallery; otherwise open single image
    const imagesToOpen = galleryImages && galleryImages.length > 0
      ? galleryImages
      : [{
          id: `image-${imageData.index}`,
          url: imageData.url,
          alt: imageData.alt
        }];
    
    const indexToUse = galleryImages && galleryImages.length > 0
      ? initialIndex
      : 0;
    
    // Trigger opening fullscreen viewer event
    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: imagesToOpen,
        initialIndex: indexToUse
      }
    }));
    
    onClose();
  }, [imageData, galleryImages, initialIndex, onClose]);

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (imageGalleryMenuRef.current) {
      const rect = imageGalleryMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      if (rect.bottom > windowHeight - padding) {
        const newTop = windowHeight - rect.height - padding;
        imageGalleryMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
      }
    }
  }, [position]);

  // Convert base64 data URL to Blob
  const dataURLToBlob = React.useCallback((dataURL: string): Blob => {
    const arr = dataURL.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }, []);

  // Convert image to PNG format (improve clipboard compatibility)
  const convertToPNG = React.useCallback(async (imageUrl: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image to PNG'));
            }
          },
          'image/png',
          1.0
        );
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image for conversion'));
      };
      
      img.src = imageUrl;
    });
  }, []);

  // Copy image to clipboard
  const handleCopyImage = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    try {
      // Check Clipboard API support
      if (!navigator.clipboard || !navigator.clipboard.write) {
        throw new Error('Clipboard API not supported');
      }
      
      // Check ClipboardItem support
      if (typeof ClipboardItem === 'undefined') {
        throw new Error('ClipboardItem not supported');
      }
      
      console.log('🔄 Processing image for clipboard...');
      
      let finalBlob: Blob;
      
      // Whether data URL or regular URL, convert to PNG via canvas
      // This avoids CSP issues and clipboard format compatibility issues
      finalBlob = await convertToPNG(imageData.url);
      
      // Validate blob
      if (finalBlob.size === 0) {
        throw new Error('Image data is empty');
      }
      
      // Create ClipboardItem and write to clipboard (use PNG format for better compatibility)
      const clipboardItem = new ClipboardItem({
        'image/png': finalBlob
      });
      
      await navigator.clipboard.write([clipboardItem]);
      
      console.log(`✅ Image copied to clipboard successfully: image/png, size: ${finalBlob.size} bytes`);
      
    } catch (error) {
      console.error('❌ Failed to copy image:', error);
      console.log('ℹ️  Image copy failed. This may be due to browser security restrictions or unsupported format.');
    }
    
    onClose();
  }, [imageData, convertToPNG, onClose]);

  // Save image
  const handleSaveAs = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    try {
      // Create a temporary <a> tag to trigger download
      const link = document.createElement('a');
      link.href = imageData.url;
      
      // Set download filename
      const fileName = imageData.alt || `image-${imageData.index + 1}`;
      link.download = fileName;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to save image:', error);
    }
    
    onClose();
  }, [imageData, onClose]);

  return (
    <div
      ref={imageGalleryMenuRef}
      className="dropdown-menu image-gallery-context-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="dropdown-menu-item"
        onClick={handleViewImage}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </span>
        <span className="dropdown-menu-item-text">View image</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleCopyImage}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Copy size={16} strokeWidth={2} />
        </span>
        <span className="dropdown-menu-item-text">Copy</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={handleSaveAs}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <Download size={16} strokeWidth={2} />
        </span>
        <span className="dropdown-menu-item-text">Save as</span>
      </button>
    </div>
  );
};

export default ImageGalleryContextMenu;