// @ts-nocheck
/** @vitest-environment happy-dom */

import { describe, it, expect, vi } from 'vitest';
import { openLocalFile, getFileNameFromPath } from '../fileTypeUtils';

describe('openLocalFile (DOM environment)', () => {
  it('dispatches fileViewer:open for previewable file with forward slash path', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    openLocalFile('/path/to/file.md');
    const event = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'fileViewer:open'
    );
    expect(event).toBeDefined();
    const detail = (event![0] as CustomEvent).detail;
    expect(detail.file.url).toBe('/path/to/file.md');
    expect(detail.file.name).toBe('file.md');
    dispatchSpy.mockRestore();
  });

  it('dispatches fileViewer:open for previewable file with backslash path', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    openLocalFile('C:\\Users\\test\\notes.txt');
    const event = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'fileViewer:open'
    );
    expect(event).toBeDefined();
    const detail = (event![0] as CustomEvent).detail;
    expect(detail.file.name).toBe('notes.txt');
    dispatchSpy.mockRestore();
  });

  it('dispatches fileViewer:open for bare filename (no path separators)', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    openLocalFile('readme.md');
    const event = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'fileViewer:open'
    );
    expect(event).toBeDefined();
    const detail = (event![0] as CustomEvent).detail;
    expect(detail.file.name).toBe('readme.md');
    dispatchSpy.mockRestore();
  });

  it('calls workspace.openPath for non-previewable files (Office)', () => {
    const openPath = vi.fn();
    (window as any).electronAPI = { workspace: { openPath } };
    openLocalFile('/path/to/document.docx');
    expect(openPath).toHaveBeenCalledWith('/path/to/document.docx');
  });

  it('dispatches imageViewer:open for image files', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    openLocalFile('/path/to/photo.png');
    const event = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'imageViewer:open'
    );
    expect(event).toBeDefined();
    const detail = (event![0] as CustomEvent).detail;
    expect(detail.images[0].alt).toBe('photo.png');
    dispatchSpy.mockRestore();
  });

  it('calls workspace.openPath for unknown file types', () => {
    const openPath = vi.fn();
    (window as any).electronAPI = { workspace: { openPath } };
    openLocalFile('/path/to/archive.zip');
    expect(openPath).toHaveBeenCalledWith('/path/to/archive.zip');
  });

  it('does not throw when electronAPI is undefined for non-previewable files', () => {
    (window as any).electronAPI = undefined;
    expect(() => openLocalFile('/path/to/file.xlsx')).not.toThrow();
  });
});

describe('getFileNameFromPath', () => {
  it('extracts filename from forward slash path', () => {
    expect(getFileNameFromPath('/Users/test/file.md')).toBe('file.md');
  });

  it('extracts filename from backslash path', () => {
    expect(getFileNameFromPath('C:\\Users\\test\\file.docx')).toBe('file.docx');
  });

  it('returns filename as-is when no separators', () => {
    expect(getFileNameFromPath('readme.md')).toBe('readme.md');
  });

  it('handles trailing separator by returning full path', () => {
    expect(getFileNameFromPath('/path/to/')).toBe('/path/to/');
  });
});
