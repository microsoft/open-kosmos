/**
 * File type utilities for consistent file handling across the app.
 * Determines whether a file should open in the inline preview or with system default app.
 */
import { buildLocalFileUrl } from './urlUtils';

/** Office file extensions - should open with system default app */
export const OFFICE_EXTENSIONS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp',
]);

/** Previewable file extensions - should open in inline preview */
const PREVIEWABLE_EXTENSIONS = new Set([
  // Markdown
  'md', 'markdown',
  // Text
  'txt', 'csv', 'tsv', 'cfg', 'conf', 'env', 'log', 'gitignore',
  // JSON
  'json',
  // HTML
  'html', 'htm',
  // PDF
  'pdf',
  // Code files
  'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx',
  'css', 'scss', 'less', 'sass',
  'py', 'rb',
  'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hxx',
  'cs', 'go', 'rs',
  'swift', 'm',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql',
  'xml', 'svg', 'yaml', 'yml', 'toml', 'ini',
  'dockerfile', 'makefile',
  'php', 'pl', 'pm', 'lua', 'r',
  'dart', 'ex', 'exs', 'hs',
]);

/**
 * Get file extension from a file path or name.
 */
export function getFileExtension(filePath: string): string {
  const fileName = filePath.includes('/')
    ? filePath.split('/').pop() || filePath
    : filePath.includes('\\')
      ? filePath.split('\\').pop() || filePath
      : filePath;

  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Check if a file is an Office document that should open with system default app.
 */
export function isOfficeFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return OFFICE_EXTENSIONS.has(ext);
}

/**
 * Check if a file can be previewed in the inline file viewer.
 */
export function isPreviewableFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return PREVIEWABLE_EXTENSIONS.has(ext);
}

/** Image file extensions - should open in image viewer */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif',
]);

/**
 * Check if a file is an image that should open in image viewer.
 */
export function isImageFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Determine the appropriate action for opening a file.
 * @returns 'preview' for inline preview, 'image' for image viewer, 'external' for system default app
 */
export function getFileOpenAction(filePath: string): 'preview' | 'image' | 'external' {
  if (isImageFile(filePath)) {
    return 'image';
  }
  if (isOfficeFile(filePath)) {
    return 'external';
  }
  if (isPreviewableFile(filePath)) {
    return 'preview';
  }
  // Default to external for unknown file types
  return 'external';
}

/**
 * Get filename from a file path (handles forward and backslash separators).
 */
export function getFileNameFromPath(filePath: string): string {
  if (filePath.includes('/')) {
    return filePath.split('/').pop() || filePath;
  }
  if (filePath.includes('\\')) {
    return filePath.split('\\').pop() || filePath;
  }
  return filePath;
}

/**
 * Open a local file with the appropriate handler:
 * - Image files → dispatch imageViewer:open event
 * - Previewable files → dispatch fileViewer:open event for inline preview
 * - Non-previewable files → open with system default app via electronAPI
 */
export function openLocalFile(filePath: string): void {
  const action = getFileOpenAction(filePath);
  const fileName = getFileNameFromPath(filePath);
  if (action === 'image') {
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: `file-link-${filePath}`, url: buildLocalFileUrl(filePath), alt: fileName }],
          initialIndex: 0,
        },
      }),
    );
  } else if (action === 'preview') {
    window.dispatchEvent(
      new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: fileName,
            url: filePath,
          },
        },
      }),
    );
  } else {
    window.electronAPI?.workspace?.openPath(filePath);
  }
}
