/**
 * Storage-optimized image compression utility
 * Specifically for historical storage compression after conversations end
 */

import { ImageContentPart } from '../../types/chatTypes';

export interface StorageCompressionResult {
  dataUrl: string;
  compressedSize: number;
  width: number;
  height: number;
  compressionRatio: number;
}

export interface StorageCompressionConfig {
  maxSizeBytes: number;        // Default 100KB
  maxDimension: number;        // Default 512px
  quality: number;             // Default 0.3
  format: 'jpeg' | 'webp';     // Default 'jpeg'
}

const DEFAULT_STORAGE_CONFIG: StorageCompressionConfig = {
  maxSizeBytes: 100 * 1024,    // 100KB
  maxDimension: 512,           // 512px
  quality: 0.3,                // Aggressive compression
  format: 'jpeg'
};

/**
 * Image compression optimized for historical storage
 * Target: ≤100KB, to reduce context burden
 */
export async function compressImageForStorage(
  file: File,
  config: Partial<StorageCompressionConfig> = {}
): Promise<StorageCompressionResult> {
  const finalConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };
  
  
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    if (!ctx) {
      reject(new Error('Unable to create Canvas 2D context'));
      return;
    }
    
    img.onload = () => {
      try {
        // Calculate storage-optimized dimensions
        let { width, height } = img;
        const { maxDimension } = finalConfig;
        const originalDimensions = { width, height };
        
        
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
          
        } else {
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Optimize rendering for storage
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, width, height);
        
        // Multi-level quality attempts to reach target size
        let quality = finalConfig.quality;
        let attempts = 0;
        const maxAttempts = 8;
        
        const tryCompress = () => {
          const mimeType = finalConfig.format === 'webp' ? 'image/webp' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mimeType, quality);
          
          // Calculate actual file size (bytes after base64 decoding)
          const base64Data = dataUrl.split(',')[1];
          const sizeBytes = Math.round(base64Data.length * 3 / 4);
          
          
          if (sizeBytes <= finalConfig.maxSizeBytes || attempts >= maxAttempts || quality <= 0.05) {
            const originalSize = file.size;
            const compressionRatio = sizeBytes / originalSize;
            const savedBytes = originalSize - sizeBytes;
            const savedPercent = Math.round((1-compressionRatio)*100);
            
            
            resolve({
              dataUrl,
              compressedSize: sizeBytes,
              width,
              height,
              compressionRatio
            });
          } else {
            // Reduce quality and continue trying
            quality = Math.max(0.05, quality - 0.05);
            attempts++;
            setTimeout(tryCompress, 0); // Continue asynchronously to avoid blocking
          }
        };
        
        tryCompress();
        
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    
    // Use FileReader to convert to data URL, avoiding CSP restrictions
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        img.src = dataUrl;
      } else {
        reject(new Error('FileReader conversion failed'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract and compress image from ImageContentPart
 */
export async function compressImagePartForStorage(
  imagePart: ImageContentPart,
  config: Partial<StorageCompressionConfig> = {}
): Promise<ImageContentPart> {

  try {
    // Extract image data from data URL
    const dataUrl = imagePart.image_url.url;
    if (!dataUrl.startsWith('data:')) {
      const errorMsg = 'Only data URL format images are supported';
      throw new Error(errorMsg);
    }
    
    const [header, base64Data] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    
    
    // Convert to File object
    const binaryData = atob(base64Data);
    const bytes = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      bytes[i] = binaryData.charCodeAt(i);
    }
    
    const file = new File([bytes], imagePart.metadata.fileName, { type: mimeType });
    
    
    // Execute storage compression
    const result = await compressImageForStorage(file, config);
    
    // Create compressed ImageContentPart
    const compressedImagePart: ImageContentPart = {
      ...imagePart,
      image_url: {
        ...imagePart.image_url,
        url: result.dataUrl,
        detail: 'low' // Use low quality for storage
      },
      metadata: {
        ...imagePart.metadata,
        fileSize: result.compressedSize,
        width: result.width,
        height: result.height,
        // Additional fields to mark compression status
        storageCompressed: true,
        originalSize: imagePart.metadata.fileSize,
        compressionRatio: result.compressionRatio,
        compressionStage: imagePart.metadata.compressionStage === 'first' ? 'both' : 'second'
      }
    };
    
    
    return compressedImagePart;
    
  } catch (error) {
    throw error;
  }
}

/**
 * Batch compress all images in a message
 */
export async function compressMessageImagesForStorage(
  message: any,
  config: Partial<StorageCompressionConfig> = {}
): Promise<any> {
  const finalConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };
  

  if (!Array.isArray(message.content)) {
    return message;
  }
  
  // Analyze message content
  const imageParts = message.content.filter((part: any) => part.type === 'image');
  const totalImages = imageParts.length;
  const eligibleImages = imageParts.filter((part: any) =>
    part.metadata?.fileSize > finalConfig.maxSizeBytes && !part.metadata?.storageCompressed
  );
  

  if (eligibleImages.length === 0) {
    return message;
  }
  
  const compressedContent: any[] = [];
  let compressionApplied = false;
  let successfulCompressions = 0;
  let failedCompressions = 0;
  let totalSavedBytes = 0;
  
  for (let i = 0; i < message.content.length; i++) {
    const part = message.content[i];
    
    if (part.type === 'image') {
      const imagePart = part as ImageContentPart;
      
      
      // Check if storage compression is needed
      if (imagePart.metadata.fileSize > finalConfig.maxSizeBytes && !imagePart.metadata.storageCompressed) {
        try {
          const compressedImagePart = await compressImagePartForStorage(imagePart, config);
          compressedContent.push(compressedImagePart);
          compressionApplied = true;
          successfulCompressions++;
          
          const savedBytes = imagePart.metadata.fileSize - compressedImagePart.metadata.fileSize;
          totalSavedBytes += savedBytes;
          
          
        } catch (error) {
          failedCompressions++;
          compressedContent.push(part);
        }
      } else {
        // Image is already small enough or already compressed
        const reason = imagePart.metadata.storageCompressed ? 'already compressed' : 'size within limit';
        compressedContent.push(part);
      }
    } else {
      // Non-image content
      compressedContent.push(part);
    }
  }
  
  // Output final statistics
  
  if (compressionApplied) {
    const compressedMessage = {
      ...message,
      content: compressedContent
    };
    
    
    return compressedMessage;
  }
  
  return message;
}

/**
 * Check if an image needs storage compression
 */
export function shouldCompressForStorage(imagePart: ImageContentPart, maxSize: number = 100 * 1024): boolean {
  const needsCompression = imagePart.metadata.fileSize > maxSize && !imagePart.metadata.storageCompressed;
  
  
  return needsCompression;
}