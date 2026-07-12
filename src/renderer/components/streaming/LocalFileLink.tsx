/**
 * LocalFileLink — A clickable link component for local file paths.
 * Opens previewable files in inline viewer, others with system default app.
 */
import React from 'react';
import { openLocalFile } from '../../lib/utils/fileTypeUtils';
import { stripFileScheme, isLocalFilePath, getFileName } from '../../lib/chat/filePathUtils';

export interface LocalFileLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Renders a local file path as a clickable link that opens via the unified
 * file-open routing (preview for previewable, system app for others).
 */
export const LocalFileLink: React.FC<LocalFileLinkProps> = ({ href, children, className }) => {
  const filePath = stripFileScheme(href);
  return (
    <a
      href="#"
      className={className || 'text-primary-600 hover:text-primary-800 underline cursor-pointer'}
      title={filePath}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        openLocalFile(filePath);
      }}
    >
      {children}
    </a>
  );
};

/**
 * Creates an onClick handler for opening a local file path.
 */
export const createFileOpenHandler = (filePath: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  openLocalFile(stripFileScheme(filePath));
};
