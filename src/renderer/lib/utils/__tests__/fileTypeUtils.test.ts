import { describe, it, expect, vi } from 'vitest';
import {
  getFileExtension,
  isOfficeFile,
  isPreviewableFile,
  getFileOpenAction,
  getFileNameFromPath,
  openLocalFile,
  OFFICE_EXTENSIONS,
} from '../fileTypeUtils';

describe('fileTypeUtils', () => {
  describe('getFileExtension', () => {
    it('extracts extension from simple filename', () => {
      expect(getFileExtension('document.pdf')).toBe('pdf');
      expect(getFileExtension('report.docx')).toBe('docx');
    });

    it('extracts extension from path with forward slashes', () => {
      expect(getFileExtension('/Users/test/document.md')).toBe('md');
      expect(getFileExtension('C:/Users/test/file.xlsx')).toBe('xlsx');
    });

    it('extracts extension from path with backslashes', () => {
      expect(getFileExtension('C:\\Users\\test\\document.txt')).toBe('txt');
      expect(getFileExtension('D:\\folder\\file.json')).toBe('json');
    });

    it('handles multiple dots in filename', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
      expect(getFileExtension('file.test.spec.ts')).toBe('ts');
    });

    it('returns empty string for files without extension', () => {
      expect(getFileExtension('Makefile')).toBe('');
      expect(getFileExtension('README')).toBe('');
      expect(getFileExtension('.gitignore')).toBe('gitignore');
    });

    it('returns empty string for empty input', () => {
      expect(getFileExtension('')).toBe('');
    });

    it('handles path-only input with trailing separator', () => {
      expect(getFileExtension('/path/to/')).toBe('');
    });

    it('converts extension to lowercase', () => {
      expect(getFileExtension('Document.PDF')).toBe('pdf');
      expect(getFileExtension('File.DOCX')).toBe('docx');
    });
  });

  describe('isOfficeFile', () => {
    it('returns true for Office documents', () => {
      expect(isOfficeFile('document.doc')).toBe(true);
      expect(isOfficeFile('document.docx')).toBe(true);
      expect(isOfficeFile('spreadsheet.xls')).toBe(true);
      expect(isOfficeFile('spreadsheet.xlsx')).toBe(true);
      expect(isOfficeFile('presentation.ppt')).toBe(true);
      expect(isOfficeFile('presentation.pptx')).toBe(true);
    });

    it('returns true for OpenDocument formats', () => {
      expect(isOfficeFile('document.odt')).toBe(true);
      expect(isOfficeFile('spreadsheet.ods')).toBe(true);
      expect(isOfficeFile('presentation.odp')).toBe(true);
    });

    it('returns false for non-Office files', () => {
      expect(isOfficeFile('document.pdf')).toBe(false);
      expect(isOfficeFile('code.ts')).toBe(false);
      expect(isOfficeFile('readme.md')).toBe(false);
    });

    it('handles paths with directories', () => {
      expect(isOfficeFile('/path/to/document.docx')).toBe(true);
      expect(isOfficeFile('C:\\Users\\file.xlsx')).toBe(true);
    });
  });

  describe('isPreviewableFile', () => {
    it('returns true for markdown files', () => {
      expect(isPreviewableFile('readme.md')).toBe(true);
      expect(isPreviewableFile('docs.markdown')).toBe(true);
    });

    it('returns true for text files', () => {
      expect(isPreviewableFile('file.txt')).toBe(true);
      expect(isPreviewableFile('data.csv')).toBe(true);
      expect(isPreviewableFile('config.env')).toBe(true);
      expect(isPreviewableFile('app.log')).toBe(true);
    });

    it('returns true for code files', () => {
      expect(isPreviewableFile('app.ts')).toBe(true);
      expect(isPreviewableFile('component.tsx')).toBe(true);
      expect(isPreviewableFile('script.js')).toBe(true);
      expect(isPreviewableFile('style.css')).toBe(true);
      expect(isPreviewableFile('main.py')).toBe(true);
      expect(isPreviewableFile('App.java')).toBe(true);
    });

    it('returns true for JSON files', () => {
      expect(isPreviewableFile('config.json')).toBe(true);
      expect(isPreviewableFile('package.json')).toBe(true);
    });

    it('returns true for HTML files', () => {
      expect(isPreviewableFile('index.html')).toBe(true);
      expect(isPreviewableFile('page.htm')).toBe(true);
    });

    it('returns true for PDF files', () => {
      expect(isPreviewableFile('document.pdf')).toBe(true);
    });

    it('returns false for Office files', () => {
      expect(isPreviewableFile('document.docx')).toBe(false);
      expect(isPreviewableFile('spreadsheet.xlsx')).toBe(false);
    });

    it('returns false for unknown extensions', () => {
      expect(isPreviewableFile('file.xyz')).toBe(false);
      expect(isPreviewableFile('archive.zip')).toBe(false);
    });
  });

  describe('getFileOpenAction', () => {
    it('returns "external" for Office files', () => {
      expect(getFileOpenAction('document.docx')).toBe('external');
      expect(getFileOpenAction('spreadsheet.xlsx')).toBe('external');
      expect(getFileOpenAction('presentation.pptx')).toBe('external');
    });

    it('returns "preview" for previewable files', () => {
      expect(getFileOpenAction('readme.md')).toBe('preview');
      expect(getFileOpenAction('config.json')).toBe('preview');
      expect(getFileOpenAction('script.ts')).toBe('preview');
      expect(getFileOpenAction('document.pdf')).toBe('preview');
    });

    it('returns "external" for unknown file types', () => {
      expect(getFileOpenAction('archive.zip')).toBe('external');
      expect(getFileOpenAction('video.mp4')).toBe('external');
    });

    it('returns "image" for image files', () => {
      expect(getFileOpenAction('photo.png')).toBe('image');
      expect(getFileOpenAction('image.jpg')).toBe('image');
      expect(getFileOpenAction('pic.webp')).toBe('image');
    });

    it('handles full paths correctly', () => {
      expect(getFileOpenAction('/Users/test/document.docx')).toBe('external');
      expect(getFileOpenAction('C:\\Users\\test\\readme.md')).toBe('preview');
    });
  });

  describe('OFFICE_EXTENSIONS', () => {
    it('contains all expected Office extensions', () => {
      const expected = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'];
      expected.forEach(ext => {
        expect(OFFICE_EXTENSIONS.has(ext)).toBe(true);
      });
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
  });

  describe('openLocalFile', () => {
    it('is exported and callable', () => {
      expect(typeof openLocalFile).toBe('function');
    });
  });
});
