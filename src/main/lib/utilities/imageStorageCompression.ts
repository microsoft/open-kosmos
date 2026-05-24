/**
 * Main-process image storage compression utilities.
 * Uses the sharp library to process images in the Node.js environment.
 */

import sharp from 'sharp';
import { ImageContentPart } from '@shared/types/chatTypes';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

/** Max raw image size accepted for inline embedding (data URI in LLM message). */
export const MAX_IMAGE_BYTES_FOR_INLINE = 10 * 1024 * 1024;
/** Max post-compression image size accepted for inline embedding. Beyond this, drop the image. */
export const MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE = 4 * 1024 * 1024;

export interface StorageCompressionConfig {
  maxSizeBytes: number;        // Default: 100KB
  maxDimension: number;        // Default: 512px
  quality: number;             // Default: 30 (0-100)
  format: 'jpeg' | 'webp';     // Default: 'jpeg'
}

const DEFAULT_STORAGE_CONFIG: StorageCompressionConfig = {
  maxSizeBytes: 50 * 1024,     // 50KB
  maxDimension: 512,           // 512px
  quality: 30,                 // Aggressive compression (0-100 scale for sharp)
  format: 'jpeg'
};

/**
 * First-pass compression config for images uploaded via the User Agent flow.
 * The frontend handles the first pass via the Canvas API, but the main-process Node.js environment
 * cannot use that, so the same logic is implemented here.
 * Based on the OpenAI Vision algorithm: https://platform.openai.com/docs/guides/vision#calculating-costs
 */
export interface FirstPassCompressionConfig {
  maxDimension: number;        // Max dimension cap (default 2048px)
  targetShortSide: number;     // Target short-side size (default 768px)
  quality: number;             // JPEG quality (default 80)
  format: 'jpeg' | 'webp';     // Default output format for non-JPEG inputs
}

const DEFAULT_FIRST_PASS_CONFIG: FirstPassCompressionConfig = {
  maxDimension: 2048,          // VSCode: first ensure no side exceeds 2048px
  targetShortSide: 768,        // VSCode: scale the short side to 768px
  quality: 80,                 // VSCode: 0.8 quality
  format: 'jpeg'
};

/**
 * Algorithm (per VSCode):
 * 1. If both sides are <= 768px, do not compress.
 * 2. If either side > 2048px, first scale it down within 2048px.
 * 3. Scale the short side down to 768px.
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

    // Use sharp to read metadata
    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    let { width, height } = metadata;

    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }

    const originalWidth = width;
    const originalHeight = height;

    // VSCode core rule: if both sides are <= 768px, do not compress
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

    // Step 1: if either side > 2048px, scale it down within 2048px
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

    // Step 2: scale the short side down to 768px
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

    // Perform the resize
    sharpInstance = sharp(buffer).resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    });

    // Pick the output format based on the original mimeType
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
      // Default screenshot inputs to a lossy format to avoid an oversized PNG/base64 payload
      if (finalConfig.format === 'webp') {
        compressedBuffer = await sharpInstance.webp({
          quality: finalConfig.quality,
          effort: 4
        }).toBuffer();
        outputMimeType = 'image/webp';
      } else {
        compressedBuffer = await sharpInstance.flatten({
          background: '#ffffff'
        }).jpeg({
          quality: finalConfig.quality,
          progressive: true
        }).toBuffer();
        outputMimeType = 'image/jpeg';
      }
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
 * Compress an image with sharp (main-process version).
 */
export async function compressImageForStorage(
  dataUrl: string,
  config: Partial<StorageCompressionConfig> = {}
): Promise<{ dataUrl: string; compressedSize: number; width: number; height: number }> {
  const finalConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };

  try {
    // Extract base64 data from the data URL
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URL format');
    }

    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');


    // Process the image with sharp
    let sharpInstance = sharp(buffer);

    // Read metadata
    const metadata = await sharpInstance.metadata();
    let { width, height } = metadata;

    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }


    // Compute the new dimensions
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
 * Compress an ImageContentPart (main-process version).
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
 * Batch-compress every image in a message (main-process version).
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

  // Fix: support both image part type formats — 'image_url' and 'image'
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
    // Fix: support both image part type formats — 'image_url' and 'image'
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