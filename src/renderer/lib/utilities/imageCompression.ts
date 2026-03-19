// src/renderer/lib/utilities/imageCompression.ts
// Image compression utilities - includes all image compression related functions
// Integrates VSCode official algorithm and CSP compatibility support

/**
 * CSP compatibility detection result
 */
export interface CSPCompatibilityResult {
  supportsBlobURL: boolean;
  supportsDataURL: boolean;
  error?: string;
}

/**
 * Image compression options
 */
export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Image compression result
 */
export interface ImageCompressionResult {
  compressedFile: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
}

/**
 * VSCode official image compression result
 */
export interface VSCodeImageCompressionResult {
  compressedFile: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
}

// VSCode official image limits - strictly aligned with VSCode implementation
export const VSCODE_IMAGE_LIMITS = {
  // VSCode official comment: Maximum image size is 5MB
  MAX_SIZE_MB: 5,
  MAX_SIZE_BYTES: 5 * 1024 * 1024, // 5MB in bytes
  
  // 🔥 New: strict limits for GitHub Copilot API
  // Prevent 413 Request Entity Too Large errors
  STRICT_MAX_SIZE_MB: 1, // Strict limit: single image not exceeding 1MB
  STRICT_MAX_SIZE_BYTES: 1 * 1024 * 1024, // 1MB in bytes
  
  // VSCode compression algorithm parameters - fully aligned with OpenAI algorithm
  // Based on: https://platform.openai.com/docs/guides/vision#calculating-costs
  MAX_DIMENSION: 2048, // Maximum dimension limit
  SCALE_TARGET_DIMENSION: 768, // Scale target dimension
  DEFAULT_QUALITY: 0.8,
  
  // 🔥 New: more aggressive compression settings to prevent API request being too large
  AGGRESSIVE_QUALITY: 0.6, // Lower quality to reduce file size
  AGGRESSIVE_TARGET_DIMENSION: 512 // Smaller target dimension
} as const;

/**
 * Detect current environment's CSP compatibility
 */
export async function detectCSPCompatibility(): Promise<CSPCompatibilityResult> {
  const result: CSPCompatibilityResult = {
    supportsBlobURL: false,
    supportsDataURL: false
  };

  // Test Data URL support
  try {
    const img = new Image();
    const testDataURL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        result.supportsDataURL = true;
        resolve();
      };
      img.onerror = () => reject(new Error('Data URL not supported'));
      img.src = testDataURL;
      
      // Set timeout
      setTimeout(() => reject(new Error('Data URL test timeout')), 2000);
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Test Blob URL support
  try {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        result.supportsBlobURL = true;
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Blob URL not supported'));
      };
      img.src = url;
      
      // Set timeout
      setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Blob URL test timeout'));
      }, 2000);
    });
  } catch (error) {
  }

  return result;
}

/**
 * Detect image dimensions
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * VSCode official image compression algorithm - directly ported from VSCode source
 * Source: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/imageUtils.ts
 * Based on OpenAI's image processing algorithm: https://platform.openai.com/docs/guides/vision#calculating-costs
 * 
 * Note: OR (||) condition is used here, not AND (&&)
 */
export async function resizeImageVSCodeOfficial(data: Uint8Array | File, mimeType?: string): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';
  
  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
    const reader = new FileReader();
    
    reader.onload = () => {
      const img = new Image();
      const dataUrl = reader.result as string;
      img.src = dataUrl;

      img.onload = () => {
      let { width, height } = img;


      // 🎯 VSCode official condition: don't compress if either side <= 768px and not GIF
      if ((width <= 768 || height <= 768) && !isGif) {
        resolve(fileData);
        return;
      }


      // VSCode official two-phase compression algorithm
      // Phase 1: if exceeding 2048px, scale down to within 2048px
      if (width > 2048 || height > 2048) {
        const scaleFactor = 2048 / Math.max(width, height);
        width = Math.round(width * scaleFactor);
        height = Math.round(height * scaleFactor);
      }

      // Phase 2: scale short side to 768px
      const scaleFactor = 768 / Math.min(width, height);
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // VSCode official format handling
      const jpegTypes = ['image/jpeg', 'image/jpg'];
      const outputMimeType = mimeType && jpegTypes.includes(mimeType) ? 'image/jpeg' : 'image/png';

      canvas.toBlob(blob => {
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(new Uint8Array(reader.result as ArrayBuffer));
          };
          reader.onerror = (error) => reject(error);
          reader.readAsArrayBuffer(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, outputMimeType);
      };
      
      img.onerror = (error) => {
        reject(error);
      };
    };
    
    reader.onerror = (error) => {
      reject(error);
    };
    
    reader.readAsDataURL(blob);
  });
}

/**
 * VSCode official smart compression - wrapper function
 */
export async function smartCompressImageVSCodeOfficial(file: File): Promise<VSCodeImageCompressionResult> {
  const originalSize = file.size;
  

  try {
    const compressedData = await resizeImageVSCodeOfficial(file, file.type);
    
    // Determine output format
    const jpegTypes = ['image/jpeg', 'image/jpg'];
    const outputMimeType = jpegTypes.includes(file.type) ? 'image/jpeg' : 'image/png';
    const outputExtension = outputMimeType === 'image/jpeg' ? '.jpg' : '.png';
    
    // Create compressed file
    const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
    const compressedFile = new File([new Uint8Array(compressedData)], compressedFileName, {
      type: outputMimeType,
      lastModified: Date.now()
    });

    const compressedSize = compressedFile.size;
    const compressionRatio = compressedSize / originalSize;
    const wasCompressed = compressedSize < originalSize;


    return {
      compressedFile,
      originalSize,
      compressedSize,
      compressionRatio,
      wasCompressed
    };

  } catch (error) {
    throw new Error(`VSCode official compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * VSCode official compression condition check
 */
export async function shouldCompressImageVSCodeOfficial(file: File): Promise<boolean> {
  // File size check (assuming VSCode also has size limit)
  if (file.size > 5 * 1024 * 1024) { // 5MB
    return true;
  }

  try {
    // Get image dimensions
    const dimensions = await getImageDimensions(file);
    const isGif = file.type === 'image/gif';
    
    // VSCode official logic: compress if either side > 768px or if GIF
    const needsCompression = (dimensions.width > 768 || dimensions.height > 768) || isGif;
    
    
    return needsCompression;
  } catch (error) {
    return false;
  }
}

/**
 * VSCode official compression algorithm - exact copy of VSCode implementation
 * Based on: https://platform.openai.com/docs/guides/vision#calculating-costs
 */
export async function resizeImageVSCodeStyle(
  data: Uint8Array | File,
  mimeType?: string
): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';
  
  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
      const reader = new FileReader();
      
      
      reader.onload = () => {
        try {
          const img = new Image();
          const dataUrl = reader.result as string;
          img.src = dataUrl;

          img.onload = () => {
            try {
          let { width, height } = img;
          

          // VSCode core logic: if image is small enough and not GIF, return directly
          // Note: skip compression only when both dimensions are <= 768px
          if ((width <= VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION &&
               height <= VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION) && !isGif) {
            resolve(fileData);
            return;
          }


          // Step 1: ensure image doesn't exceed 2048px (VSCode logic)
          if (width > VSCODE_IMAGE_LIMITS.MAX_DIMENSION ||
              height > VSCODE_IMAGE_LIMITS.MAX_DIMENSION) {
            const scaleFactor = VSCODE_IMAGE_LIMITS.MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scaleFactor);
            height = Math.round(height * scaleFactor);
          }

          // Step 2: scale short side to 768px (VSCode logic)
          const shortSide = Math.min(width, height);
          if (shortSide > VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION) {
            const scaleFactor = VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION / shortSide;
            width = Math.round(width * scaleFactor);
            height = Math.round(height * scaleFactor);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error('Cannot get Canvas 2D context, browser may not support it'));
            return;
          }

          
          // Optimize large image processing: set more conservative rendering quality for performance
          ctx.imageSmoothingEnabled = true;
          
          // Dynamically adjust rendering quality based on image size
          const pixelCount = width * height;
          if (pixelCount > 2000000) { // Use medium quality for over 2M pixels
            ctx.imageSmoothingQuality = 'medium';
          } else {
            ctx.imageSmoothingQuality = 'high';
          }
          
          // Add Canvas drawing performance monitoring
          const drawStartTime = performance.now();
          
          try {
            ctx.drawImage(img, 0, 0, width, height);
            const drawEndTime = performance.now();
          } catch (error) {
            reject(new Error(`Canvas drawing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            return;
          }

          // VSCode format conversion logic
          const jpegTypes = ['image/jpeg', 'image/jpg'];
          const outputMimeType = mimeType && jpegTypes.includes(mimeType) ?
            'image/jpeg' : 'image/png';
          

          // Use more efficient compression quality settings, optimized for large images
          const quality = outputMimeType === 'image/jpeg' ? VSCODE_IMAGE_LIMITS.DEFAULT_QUALITY : 0.9;
          
          // Add performance monitoring
          const blobStartTime = performance.now();
          
          canvas.toBlob(blob => {
            try {
              const blobEndTime = performance.now();
              
              if (!blob) {
                reject(new Error('Canvas to Blob conversion failed, image may be too large or format unsupported'));
                return;
              }
              
              
              // Use more efficient ArrayBuffer reading method
              const reader = new FileReader();
              const readerStartTime = performance.now();
              
              reader.onload = () => {
                try {
                  const readerEndTime = performance.now();
                  
                  const result = reader.result as ArrayBuffer;
                  if (!result) {
                    reject(new Error('FileReader result is empty'));
                    return;
                  }
                  resolve(new Uint8Array(result));
                } catch (error) {
                  reject(new Error(`FileReader processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
              };
              
              reader.onerror = (error) => {
                reject(new Error(`FileReader read failed: ${error}`));
              };
              
              // Add FileReader timeout handling
              const readerTimeout = setTimeout(() => {
                reject(new Error('FileReader read timeout, file may be too large'));
              }, 30000);
              
              reader.addEventListener('loadend', () => {
                clearTimeout(readerTimeout);
              });
              
              reader.readAsArrayBuffer(blob);
            } catch (error) {
              reject(new Error(`Blob processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          }, outputMimeType, quality);
            } catch (error) {
              reject(new Error(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          };
          
          img.onerror = (error) => {
            reject(new Error(`Image loading failed, file may be corrupted or format unsupported: ${error}`));
          };
        } catch (error) {
          reject(new Error(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };
      
      reader.onerror = (error) => {
        reject(new Error(`File read failed, file may be corrupted: ${error}`));
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(new Error(`Compression initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

/**
 * 🔥 New: aggressive compression mode - prevents GitHub Copilot API 413 errors
 * Uses smaller dimensions and lower quality to ensure file size is within limits
 */
async function resizeImageAggressively(
  data: Uint8Array | File,
  mimeType?: string
): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';
  
  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
      const reader = new FileReader();
      
      
      reader.onload = () => {
        try {
          const img = new Image();
          const dataUrl = reader.result as string;
          img.src = dataUrl;

          img.onload = () => {
            try {
              let { width, height } = img;
              

              // 🔥 Aggressive mode: scale directly to 512px (short side)
              const targetDimension = VSCODE_IMAGE_LIMITS.AGGRESSIVE_TARGET_DIMENSION;
              
              // Step 1: ensure image doesn't exceed 1024px
              if (width > 1024 || height > 1024) {
                const scaleFactor = 1024 / Math.max(width, height);
                width = Math.round(width * scaleFactor);
                height = Math.round(height * scaleFactor);
              }

              // Step 2: scale short side to 512px
              const shortSide = Math.min(width, height);
              if (shortSide > targetDimension) {
                const scaleFactor = targetDimension / shortSide;
                width = Math.round(width * scaleFactor);
                height = Math.round(height * scaleFactor);
              }

              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              
              if (!ctx) {
                reject(new Error('Cannot get Canvas 2D context'));
                return;
              }

              
              // Use low quality settings for faster compression
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'low';
              
              try {
                ctx.drawImage(img, 0, 0, width, height);
              } catch (error) {
                reject(new Error(`Canvas drawing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                return;
              }

              // 🔥 Force JPEG format and low quality for maximum compression
              const outputMimeType = 'image/jpeg';
              const quality = VSCODE_IMAGE_LIMITS.AGGRESSIVE_QUALITY; // 0.6
              
              
              canvas.toBlob(blob => {
                try {
                  if (!blob) {
                    reject(new Error('Aggressive compression: Canvas to Blob conversion failed'));
                    return;
                  }
                  
                  
                  const reader = new FileReader();
                  
                  reader.onload = () => {
                    try {
                      const result = reader.result as ArrayBuffer;
                      if (!result) {
                        reject(new Error('Aggressive compression: FileReader result is empty'));
                        return;
                      }
                      
                      
                      resolve(new Uint8Array(result));
                    } catch (error) {
                      reject(new Error(`Aggressive compression FileReader processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                    }
                  };
                  
                  reader.onerror = (error) => {
                    reject(new Error(`Aggressive compression FileReader read failed: ${error}`));
                  };
                  
                  reader.readAsArrayBuffer(blob);
                } catch (error) {
                  reject(new Error(`Aggressive compression Blob processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
              }, outputMimeType, quality);
            } catch (error) {
              reject(new Error(`Aggressive compression image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          };
          
          img.onerror = (error) => {
            reject(new Error(`Aggressive compression image loading failed: ${error}`));
          };
        } catch (error) {
          reject(new Error(`Aggressive compression image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };
      
      reader.onerror = (error) => {
        reject(new Error(`Aggressive compression file read failed: ${error}`));
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(new Error(`Aggressive compression initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

/**
 * Check if image needs compression - strictly aligned with VSCode logic
 */
export async function shouldCompressImageVSCodeStyle(file: File): Promise<boolean> {
  // 1. Check if file size exceeds 5MB limit
  if (file.size > VSCODE_IMAGE_LIMITS.MAX_SIZE_BYTES) {
    return true;
  }

  // 2. Check image dimensions - VSCode compression condition
  try {
    const dimensions = await getImageDimensions(file);
    const isGif = file.type === 'image/gif';
    
    // VSCode logic: compress if image is larger than 768px or is GIF
    const needsCompression = (
      dimensions.width > VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION && 
      dimensions.height > VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION
    ) || isGif;
    
    
    return needsCompression;
  } catch (error) {
    return false;
  }
}

/**
 * Smart image compression - VSCode style
 */
export async function smartCompressImageVSCodeStyle(file: File): Promise<ImageCompressionResult> {
  const originalSize = file.size;
  

  try {
    // 🔥 New: check if aggressive compression mode is needed
    const needsAggressiveCompression = originalSize > VSCODE_IMAGE_LIMITS.STRICT_MAX_SIZE_BYTES;
    
    if (needsAggressiveCompression) {
      
      // Use more aggressive compression parameters
      const aggressiveCompressedData = await resizeImageAggressively(file, file.type);
      
      // Determine output format - prefer JPEG to reduce file size
      const outputMimeType = 'image/jpeg'; // Force JPEG format
      const outputExtension = '.jpg';
      
      // Create compressed file
      const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
      const compressedFile = new File([new Uint8Array(aggressiveCompressedData)], compressedFileName, {
        type: outputMimeType,
        lastModified: Date.now()
      });

      const compressedSize = compressedFile.size;
      const compressionRatio = compressedSize / originalSize;
      const wasCompressed = compressedSize < originalSize;


      // 🔥 Strict check: if still too large after compression, throw error
      if (compressedSize > VSCODE_IMAGE_LIMITS.STRICT_MAX_SIZE_BYTES) {
        const compressedSizeMB = Math.round(compressedSize / (1024 * 1024) * 100) / 100;
        throw new Error(`Even with aggressive compression, image is still too large (${compressedSizeMB}MB), cannot send to GitHub Copilot API. Try using a smaller original image.`);
      }

      return {
        compressedFile,
        originalSize,
        compressedSize,
        compressionRatio,
        wasCompressed
      };
    } else {
      // Use standard VSCode compression algorithm
      const compressedData = await resizeImageVSCodeStyle(file, file.type);
      
      // Determine output format (following VSCode logic)
      const jpegTypes = ['image/jpeg', 'image/jpg'];
      const outputMimeType = jpegTypes.includes(file.type) ? 'image/jpeg' : 'image/png';
      const outputExtension = outputMimeType === 'image/jpeg' ? '.jpg' : '.png';
      
      // Create compressed file
      const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
      const compressedFile = new File([new Uint8Array(compressedData)], compressedFileName, {
        type: outputMimeType,
        lastModified: Date.now()
      });

      const compressedSize = compressedFile.size;
      const compressionRatio = compressedSize / originalSize;
      const wasCompressed = compressedSize < originalSize;


      return {
        compressedFile,
        originalSize,
        compressedSize,
        compressionRatio,
        wasCompressed
      };
    }

  } catch (error) {
    
    // Provide more detailed error messages and solutions
    let errorMessage = 'Image compression failed';
    let suggestedSolution = '';
    
    if (error instanceof Error) {
      if (error.message.includes('Canvas') || error.message.includes('canvas')) {
        errorMessage = 'Image compression failed: browser Canvas processing error';
        suggestedSolution = 'Possible cause: image too large or special format. Suggestion: use a smaller image or PNG/JPEG format';
      } else if (error.message.includes('Blob') || error.message.includes('blob')) {
        errorMessage = 'Image compression failed: image format conversion error';
        suggestedSolution = 'Suggestion: try PNG or JPEG format images';
      } else if (error.message.includes('FileReader') || error.message.includes('File read failed')) {
        errorMessage = 'Image compression failed: file read error';
        suggestedSolution = 'Suggestion: check if the image file is complete, or try re-saving the image';
      } else if (error.message.includes('Image loading failed')) {
        errorMessage = 'Image compression failed: image cannot be loaded';
        suggestedSolution = 'Possible cause: file corrupted, format unsupported, or CSP restriction. Suggestion: use standard PNG/JPEG format';
      } else if (error.message.includes('Compression initialization failed')) {
        errorMessage = 'Image compression failed: initialization error';
        suggestedSolution = 'Suggestion: refresh the page and try again';
      } else if (error.message.includes('Content Security Policy') || error.message.includes('CSP')) {
        errorMessage = 'Image compression failed: security policy restriction';
        suggestedSolution = 'This error has been fixed by using data URLs. If it still occurs, please contact technical support';
      } else {
        errorMessage = `Image compression failed: ${error.message}`;
        suggestedSolution = 'Suggestion: try using a smaller image file or a different image format';
      }
    } else {
      errorMessage = `Image compression failed: unknown error type (${typeof error})`;
      suggestedSolution = 'Suggestion: try using a smaller image file, PNG or JPEG format recommended';
    }
    
    const finalErrorMessage = suggestedSolution ?
      `${errorMessage}。${suggestedSolution}` : errorMessage;
    
    throw new Error(finalErrorMessage);
  }
}

/**
 * Validate if file size is within VSCode limits
 */
export function validateImageFileSize(file: File): { isValid: boolean; error?: string } {
  if (file.size > VSCODE_IMAGE_LIMITS.MAX_SIZE_BYTES) {
    const fileSizeMB = Math.round(file.size / (1024 * 1024) * 10) / 10;
    return {
      isValid: false,
      error: `Image file too large (${fileSizeMB}MB), exceeds the ${VSCODE_IMAGE_LIMITS.MAX_SIZE_MB}MB limit.`
    };
  }
  return { isValid: true };
}

/**
 * Check if file needs compression - backward compatible simplified version
 */
export function shouldCompressImage(file: File): boolean {
  // Simplified version, mainly checks file size
  const sizeKB = Math.round(file.size / 1024);
  const sizeMB = Math.round(file.size / (1024 * 1024) * 10) / 10;
  
  
  // If file exceeds 2MB, recommend compression
  return sizeMB > 2;
}

/**
 * Estimate base64 size (for pre-checking)
 */
export function estimateBase64Size(fileSizeBytes: number): number {
  // Base64 encoding increases size by approximately 33%
  return Math.round(fileSizeBytes * 1.33);
}

// Backward compatible exports
export const GITHUB_COPILOT_IMAGE_LIMITS = VSCODE_IMAGE_LIMITS;
export const smartCompressImage = smartCompressImageVSCodeStyle;
export const shouldCompressImageAdvanced = shouldCompressImageVSCodeStyle;