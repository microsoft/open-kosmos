/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { FileSecurityValidator, FileAttachmentProcessor } from '../fileUtils';

describe('FileSecurityValidator', () => {
  describe('isAbsolutePath', () => {
    it('detects Unix absolute path', () => {
      expect(FileSecurityValidator.isAbsolutePath('/home/user/file.txt')).toBe(true);
    });

    it('detects Windows absolute path with backslash', () => {
      expect(FileSecurityValidator.isAbsolutePath('C:\\Users\\file.txt')).toBe(true);
    });

    it('detects Windows absolute path with forward slash', () => {
      expect(FileSecurityValidator.isAbsolutePath('C:/Users/file.txt')).toBe(true);
    });

    it('detects UNC path', () => {
      expect(FileSecurityValidator.isAbsolutePath('\\\\server\\share')).toBe(true);
    });

    it('returns false for relative path', () => {
      expect(FileSecurityValidator.isAbsolutePath('relative/path/file.txt')).toBe(false);
    });

    it('returns false for plain file name', () => {
      expect(FileSecurityValidator.isAbsolutePath('file.txt')).toBe(false);
    });
  });

  describe('isPathTraversalAttack', () => {
    it('detects ../ traversal', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('../secret')).toBe(true);
    });

    it('detects ..\\ traversal', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('..\\secret')).toBe(true);
    });

    it('detects /etc/ access', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('/etc/passwd')).toBe(true);
    });

    it('detects ~/ home directory', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('~/secret')).toBe(true);
    });

    it('detects $HOME env variable', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('$HOME/secret')).toBe(true);
    });

    it('detects %USERPROFILE% Windows variable', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('%USERPROFILE%/secret')).toBe(true);
    });

    it('returns false for safe relative path', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('folder/file.txt')).toBe(false);
    });

    it('returns false for safe absolute Windows path', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('C:/Users/user/file.txt')).toBe(false);
    });

    it('detects traversal inside Windows absolute path', () => {
      expect(FileSecurityValidator.isPathTraversalAttack('C:/Users/../etc/passwd')).toBe(true);
    });
  });

  describe('validatePath', () => {
    it('allows safe relative path', () => {
      const result = FileSecurityValidator.validatePath('folder/file.txt');
      expect(result.isValid).toBe(true);
    });

    it('rejects path traversal attack', () => {
      const result = FileSecurityValidator.validatePath('../secret');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/traversal/i);
    });

    it('rejects absolute path by default', () => {
      const result = FileSecurityValidator.validatePath('/home/user/file.txt');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/absolute/i);
    });

    it('allows absolute path when allowAbsolutePaths is true', () => {
      const result = FileSecurityValidator.validatePath('/home/user/file.txt', true);
      expect(result.isValid).toBe(true);
    });

    it('rejects /etc/passwd', () => {
      // /etc/ matches path traversal pattern first
      const result = FileSecurityValidator.validatePath('/etc/passwd', true);
      expect(result.isValid).toBe(false);
    });

    it('rejects .ssh/id_rsa', () => {
      const result = FileSecurityValidator.validatePath('.ssh/id_rsa', true);
      expect(result.isValid).toBe(false);
    });

    it('rejects .aws/credentials', () => {
      const result = FileSecurityValidator.validatePath('.aws/credentials', true);
      expect(result.isValid).toBe(false);
    });

    it('rejects windows/system32', () => {
      const result = FileSecurityValidator.validatePath('C:/Windows/System32/file.dll', true);
      expect(result.isValid).toBe(false);
    });
  });
});

describe('FileAttachmentProcessor', () => {
  describe('isTextFileByExtension', () => {
    it('recognizes .ts as text file', () => {
      expect(FileAttachmentProcessor.isTextFileByExtension('component.ts')).toBe(true);
    });

    it('recognizes .md as text file', () => {
      expect(FileAttachmentProcessor.isTextFileByExtension('README.md')).toBe(true);
    });

    it('recognizes .py as text file', () => {
      expect(FileAttachmentProcessor.isTextFileByExtension('script.py')).toBe(true);
    });

    it('returns false for .exe', () => {
      expect(FileAttachmentProcessor.isTextFileByExtension('program.exe')).toBe(false);
    });

    it('returns false for .bin', () => {
      expect(FileAttachmentProcessor.isTextFileByExtension('data.bin')).toBe(false);
    });

    it('handles uppercase extensions', () => {
      // Extension check uses toLowerCase
      expect(FileAttachmentProcessor.isTextFileByExtension('README.MD')).toBe(true);
    });
  });

  describe('createFileReference', () => {
    it('creates a file reference with correct shape', () => {
      const ref = FileAttachmentProcessor.createFileReference('/path/to/file.ts', 'file.ts', 1024);
      expect(ref.fileName).toBe('file.ts');
      expect(ref.reference).toBe('/path/to/file.ts');
      expect(ref.size).toBe(1024);
      expect(ref.isText).toBe(true);
      expect(ref.fileReference).toBeDefined();
      expect(ref.fileReference!.filePath).toBe('/path/to/file.ts');
      expect(ref.fileReference!.isTextFile).toBe(true);
    });

    it('detects correct MIME type for .ts file', () => {
      const ref = FileAttachmentProcessor.createFileReference('/f/file.ts', 'file.ts', 0);
      expect(ref.mimeType).toBe('text/typescript');
    });

    it('detects correct MIME type for .json file', () => {
      const ref = FileAttachmentProcessor.createFileReference('/f/file.json', 'file.json', 0);
      expect(ref.mimeType).toBe('application/json');
    });

    it('falls back to text/plain for unknown extension', () => {
      const ref = FileAttachmentProcessor.createFileReference('/f/file.xyz', 'file.xyz', 0);
      expect(ref.mimeType).toBe('text/plain');
    });

    it('stores optional fields when provided', () => {
      const ref = FileAttachmentProcessor.createFileReference(
        '/f/file.ts', 'file.ts', 500, 10, 100, 'ts', 'text/typescript', 1700000000000
      );
      expect(ref.fileReference!.startLine).toBe(10);
      expect(ref.fileReference!.lineCount).toBe(100);
      expect(ref.fileReference!.lastModified).toBe(1700000000000);
    });

    it('data() function returns empty buffer (metadata mode)', async () => {
      const ref = FileAttachmentProcessor.createFileReference('/f/file.ts', 'file.ts', 0);
      const data = await ref.data();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(0);
    });
  });

  describe('validateFileForAttachment', () => {
    const makeFile = (name: string, type: string, size: number): File => {
      const file = new File(['x'.repeat(Math.min(size, 1))], name, { type });
      Object.defineProperty(file, 'size', { value: size });
      return file;
    };

    it('rejects files that are too large', () => {
      const file = makeFile('large.txt', 'text/plain', 6 * 1024 * 1024);
      const result = FileAttachmentProcessor.validateFileForAttachment(file);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/too large/i);
    });

    it('accepts a small text file', () => {
      const file = makeFile('file.txt', 'text/plain', 100);
      const result = FileAttachmentProcessor.validateFileForAttachment(file);
      expect(result.valid).toBe(true);
      expect(result.isText).toBe(true);
    });

    it('accepts PNG image', () => {
      const file = makeFile('photo.png', 'image/png', 100);
      const result = FileAttachmentProcessor.validateFileForAttachment(file);
      expect(result.valid).toBe(true);
      expect(result.isText).toBe(false);
    });

    it('rejects unsupported file type', () => {
      const file = makeFile('program.exe', 'application/octet-stream', 100);
      const result = FileAttachmentProcessor.validateFileForAttachment(file);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/unsupported/i);
    });

    it('accepts file by extension even when MIME type is missing', () => {
      const file = makeFile('script.ts', '', 100);
      const result = FileAttachmentProcessor.validateFileForAttachment(file);
      expect(result.valid).toBe(true);
      expect(result.isText).toBe(true);
    });
  });

  describe('processTextFile', () => {
    it('creates metadata without storing content', async () => {
      const content = 'line1\nline2\nline3';
      const file = new File([content], 'test.ts', { type: 'text/typescript' });
      const result = await FileAttachmentProcessor.processTextFile(file);

      expect(result.fileName).toBe('test.ts');
      expect(result.isText).toBe(true);
      expect(result.fileReference!.lineCount).toBe(3);
      // Metadata mode: data() returns empty buffer
      const data = await result.data();
      expect(data.length).toBe(0);
    });

    it('uses provided filePath override', async () => {
      const file = new File(['content'], 'test.ts', { type: 'text/typescript' });
      const result = await FileAttachmentProcessor.processTextFile(file, '/absolute/path/test.ts');
      expect(result.reference).toBe('/absolute/path/test.ts');
      expect(result.fileReference!.filePath).toBe('/absolute/path/test.ts');
    });
  });

  describe('processTextFileWithContent', () => {
    it('includes text content in result', async () => {
      const content = 'hello world';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const result = await FileAttachmentProcessor.processTextFileWithContent(file);
      expect(result.text).toBe('hello world');
    });

    it('truncates files exceeding MAX_TEXT_LINES', async () => {
      // Create file with 2001 lines
      const lines = Array.from({ length: 2001 }, (_, i) => `line ${i}`);
      const content = lines.join('\n');
      const file = new File([content], 'big.txt', { type: 'text/plain' });
      const result = await FileAttachmentProcessor.processTextFileWithContent(file);
      expect(result.text).toContain('[File content truncated');
    });
  });
});
