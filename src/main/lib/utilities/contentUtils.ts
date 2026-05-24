/**
 * Content utility functions — Main Process version.
 * Provides formatting and content processing helpers.
 */

// Format a file size in human-readable form
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format a line count
export const formatLineCount = (lines: number): string => {
  if (lines === 1) return '1 line';
  return `${lines.toLocaleString()} lines`;
};
