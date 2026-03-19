/**
 * Main process image storage compression utility
 * Uses sharp library for image processing in Node.js environment
 */

import sharp from 'sharp';
import { ImageContentPart } from '../types/chatTypes';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export interface StorageCompressionConfig {
  maxSizeBytes: number;        // Default 100KB
  maxDimension: number;        // Default 512px
  quality: number;             // Default 30 (0-100)
  format: 'jpeg' | 'webp';     // Default 'jpeg'
}

const DEFAULT_STORAGE_CONFIG: StorageCompressionConfig = {
  maxSizeBytes: 50 * 1024,     // 50KB
  maxDimension: 512,           // 512px
  quality: 30,                 // Aggressive compression (0-100 scale for sharp)
  format: 'jpeg'
};

/**
 * First-pass compression config for images uploaded via User Agent mechanism.
 * User-uploaded images are first compressed in the frontend via Canvas API, but the main process
 * Node.js environment cannot use that method, so this implements it manually.
 * Based on OpenAI Vision algorithm: https://platform.openai.com/docs/guides/vision#calculating-costs
 */
export interface FirstPassCompressionConfig {
  maxDimension: number;        // Max dimension limit (default 2048px)
  targetShortSide: number;     // Short side target dimension (default 768px)
  quality: number;             // JPEG quality (default 80)
}

const DEFAULT_FIRST_PASS_CONFIG: FirstPassCompressionConfig = {
  maxDimension: 2048,          // VSCode: First ensure not exceeding 2048px
  targetShortSide: 768,        // VSCode: Scale short side to 768px
  quality: 80                  // VSCode: 0.8 quality
};

/**
 * Algorithm logic (VSCode official):
 * 1. If both sides are <= 768px, no compression
 * 2. If either side > 2048px, first scale to fit within 2048px
 * 3. Scale the short side to 768px
 */
export async function compressImageFirstPass(
  base64Data: string,
  mimeType: string,
  config: Partial<FirstPassCompressionConfig> = {}
): Promise<{ 
  base64Data: string; 
  mimeType: string; 
  width: number; 
  height: number; 
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}> {
  const finalConfig = { ...DEFAULT_FIRST_PASS_CONFIG, ...config };
  
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const originalSize = buffer.length;
    
    // Use sharp to get metadata
    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    let { width, height } = metadata;
    
    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }
    
    const originalWidth = width;
    const originalHeight = height;
    
    // VSCode core logic: if both sides are <= 768px, no compression
    if (width <= finalConfig.targetShortSide && height <= finalConfig.targetShortSide) {
      logger.info('[First Pass Compression] Image small enough, skipping compression', 'compressImageFirstPass', {
        width,
        height,
        targetShortSide: finalConfig.targetShortSide
      });
      
      return {
        base64Data,
        mimeType,
        width,
        height,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false
      };
    }
    
    // Step 1: If either side > 2048px, first scale to fit within 2048px
    if (width > finalConfig.maxDimension || height > finalConfig.maxDimension) {
      const scaleFactor = finalConfig.maxDimension / Math.max(width, height);
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);
      
      logger.info('[First Pass Compression] Step 1: Scaling to max dimension', 'compressImageFirstPass', {
        originalWidth,
        originalHeight,
        newWidth: width,
        newHeight: height,
        maxDimension: finalConfig.maxDimension
      });
    }
    
    // Step 2: Scale the short side to 768px
    const shortSide = Math.min(width, height);
    if (shortSide > finalConfig.targetShortSide) {
      const scaleFactor = finalConfig.targetShortSide / shortSide;
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);
      
      logger.info('[First Pass Compression] Step 2: Scaling short side to target', 'compressImageFirstPass', {
        shortSide,
        targetShortSide: finalConfig.targetShortSide,
        newWidth: width,
        newHeight: height
      });
    }
    
    // Execute scaling
    sharpInstance = sharp(buffer).resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    });
    
    // Decide output format based on original mimeType
    const jpegTypes = ['image/jpeg', 'image/jpg'];
    let compressedBuffer: Buffer;
    let outputMimeType: string;
    
    if (jpegTypes.includes(mimeType)) {
      compressedBuffer = await sharpInstance.jpeg({
        quality: finalConfig.quality,
        progressive: true
      }).toBuffer();
      outputMimeType = 'image/jpeg';
    } else {
      // PNG and other formats converted to PNG
      compressedBuffer = await sharpInstance.png({
        compressionLevel: 6
      }).toBuffer();
      outputMimeType = 'image/png';
    }
    
    const compressedSize = compressedBuffer.length;
    const compressedBase64 = compressedBuffer.toString('base64');
    
    logger.info('[First Pass Compression] Compression completed', 'compressImageFirstPass', {
      originalWidth,
      originalHeight,
      finalWidth: width,
      finalHeight: height,
      originalSize,
      compressedSize,
      compressionRatio: (compressedSize / originalSize * 100).toFixed(1) + '%'
    });
    
    return {
      base64Data: compressedBase64,
      mimeType: outputMimeType,
      width,
      height,
      originalSize,
      compressedSize,
      wasCompressed: true
    };
    
  } catch (error) {
    logger.error('[First Pass Compression] Compression failed', 'compressImageFirstPass', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Compress image using sharp (main process version)
 */
export async function compressImageForStorage(
  dataUrl: string,
  config: Partial<StorageCompressionConfig> = {}
): Promise<{ dataUrl: string; compressedSize: number; width: number; height: number }> {
  const finalConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };
  
  try {
    // Extract base64 data from data URL
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URL format');
    }
    
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    
    // Process image using sharp
    let sharpInstance = sharp(buffer);
    
    // Get metadata
    const metadata = await sharpInstance.metadata();
    let { width, height } = metadata;
    
    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }
    
    
    // Calculate new dimensions
    const maxDim = finalConfig.maxDimension;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      
      
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Convert to JPEG and compress
    const compressedBuffer = await sharpInstance
      .jpeg({
        quality: finalConfig.quality,
        progressive: true,
        optimizeScans: true
      })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;
    const compressedDataUrl = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
    
    
    return {
      dataUrl: compressedDataUrl,
      compressedSize,
      width,
      height
    };
    
  } catch (error) {
    logger.error('[Storage Compression] Compression failed', 'imageStorageCompression', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Compress ImageContentPart (main process version)
 */
export async function compressImagePartForStorage(
  imagePart: ImageContentPart,
  config: Partial<StorageCompressionConfig> = {}
): Promise<ImageContentPart> {

  try {
    const result = await compressImageForStorage(imagePart.image_url.url, config);
    
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
        storageCompressed: true,
        originalSize: imagePart.metadata.fileSize,
        compressionRatio: result.compressedSize / imagePart.metadata.fileSize,
        compressionStage: imagePart.metadata.compressionStage === 'first' ? 'both' : 'second'
      }
    };
    
    
    return compressedImagePart;
    
  } catch (error) {
    logger.error('[Storage Compression] ImageContentPart compression failed', 'imageStorageCompression', {
      fileName: imagePart.metadata.fileName,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Batch compress all images in a message (main process version)
 */
export async function compressMessageImagesForStorage(
  message: any,
  config: Partial<StorageCompressionConfig> = {}
): Promise<any> {
  const finalConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };
  

  if (!Array.isArray(message.content)) {
    logger.warn('[Storage Compression] Message content is not an array', 'imageStorageCompression');
    return message;
  }
  
  // 🔥 Fix: Support both image type formats - 'image_url' and 'image'
  const imageParts = message.content.filter((part: any) =>
    part.type === 'image_url' || part.type === 'image'
  );
  const eligibleImages = imageParts.filter((part: any) =>
    part.metadata?.fileSize > finalConfig.maxSizeBytes && !part.metadata?.storageCompressed
  );
  

  if (eligibleImages.length === 0) {
    return message;
  }
  
  const compressedContent: any[] = [];
  let successfulCompressions = 0;
  let totalSavedBytes = 0;
  
  for (const part of message.content) {
    // 🔥 Fix: Support both image type formats - 'image_url' and 'image'
    if (part.type === 'image_url' || part.type === 'image') {
      const imagePart = part as ImageContentPart;
      
      if (imagePart.metadata.fileSize > finalConfig.maxSizeBytes && !imagePart.metadata.storageCompressed) {
        try {
          const compressedImagePart = await compressImagePartForStorage(imagePart, config);
          compressedContent.push(compressedImagePart);
          successfulCompressions++;
          
          const savedBytes = imagePart.metadata.fileSize - compressedImagePart.metadata.fileSize;
          totalSavedBytes += savedBytes;
          
        } catch (error) {
          logger.error('[Storage Compression] Image compression failed, keeping original', 'imageStorageCompression', {
            fileName: imagePart.metadata.fileName,
            error: error instanceof Error ? error.message : String(error)
          });
          compressedContent.push(part);
        }
      } else {
        compressedContent.push(part);
      }
    } else {
      compressedContent.push(part);
    }
  }
  
  
  return {
    ...message,
    content: compressedContent
  };
}