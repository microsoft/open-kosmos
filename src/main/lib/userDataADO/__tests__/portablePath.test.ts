/**
 * Portable Path Utilities unit tests
 *
 * Tests cross-OS path conversion functionality:
 * - detectForeignOS: Detecting paths from other operating systems
 * - extractProfileRelativePath: Extracting profile-relative portions from absolute paths
 * - convertToLocalPath: Converting foreign OS paths to local format
 * - needsPathConversion: Checking if a path needs conversion
 * - convertAgentPathsToLocal: Converting agent config path fields
 * 
 * These tests run on all platforms (Windows, macOS, Linux).
 * The mock returns a platform-appropriate local profile directory.
 */

import * as path from 'path';

// Determine the mock profile path based on actual test runner platform
function getMockProfilePath(alias: string): string {
  if (process.platform === 'win32') {
    return `C:\\Users\\testuser\\AppData\\Roaming\\openkosmos-app\\profiles\\${alias}`;
  } else if (process.platform === 'darwin') {
    return `/Users/testuser/Library/Application Support/openkosmos-app/profiles/${alias}`;
  } else {
    return `/home/testuser/.config/openkosmos-app/profiles/${alias}`;
  }
}

// Mock pathUtils — portablePath.ts imports { getProfileDirectoryPath } from './pathUtils'
vi.mock('../pathUtils', async () => ({
  getProfileDirectoryPath: vi.fn((alias: string) => {
    // Dynamic mock based on actual platform (evaluated at call time, not mock definition time)
    const platform = process.platform;
    if (platform === 'win32') {
      return `C:\\Users\\testuser\\AppData\\Roaming\\openkosmos-app\\profiles\\${alias}`;
    } else if (platform === 'darwin') {
      return `/Users/testuser/Library/Application Support/openkosmos-app/profiles/${alias}`;
    } else {
      return `/home/testuser/.config/openkosmos-app/profiles/${alias}`;
    }
  }),
}));

import {
  convertToLocalPath,
  needsPathConversion,
} from '../portablePath';

// Store original platform
const originalPlatform = process.platform;

// Helper to mock process.platform
function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true,
  });
}

// Restore platform after each test
afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    writable: true,
    configurable: true,
  });
});

// ============================================================
// needsPathConversion
// ============================================================
describe('needsPathConversion', () => {
  describe('on Windows', () => {
    beforeEach(() => mockPlatform('win32'));

    it('should return true for Unix profile path on Windows', () => {
      const unixPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123';
      expect(needsPathConversion(unixPath)).toBe(true);
    });

    it('should return false for Windows path on Windows', () => {
      const winPath = 'C:\\Users\\john\\AppData\\Roaming\\openkosmos-app\\profiles\\john_ms\\chat_workspaces\\chat_123';
      expect(needsPathConversion(winPath)).toBe(false);
    });

    it('should return false for Unix non-profile path on Windows', () => {
      const unixPath = '/Users/john/Documents/some-file.txt';
      expect(needsPathConversion(unixPath)).toBe(false);
    });
  });

  describe('on macOS/Linux', () => {
    beforeEach(() => mockPlatform('darwin'));

    it('should return true for Windows profile path on macOS', () => {
      const winPath = 'C:\\Users\\john\\AppData\\Roaming\\openkosmos-app\\profiles\\john_ms\\chat_workspaces\\chat_123';
      expect(needsPathConversion(winPath)).toBe(true);
    });

    it('should return false for Unix path on macOS', () => {
      const unixPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123';
      expect(needsPathConversion(unixPath)).toBe(false);
    });

    it('should return false for Windows non-profile path on macOS', () => {
      const winPath = 'C:\\Users\\john\\Documents\\some-file.txt';
      expect(needsPathConversion(winPath)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for null', () => {
      expect(needsPathConversion(null as any)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(needsPathConversion(undefined as any)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(needsPathConversion('')).toBe(false);
    });

    it('should return false for non-string', () => {
      expect(needsPathConversion(123 as any)).toBe(false);
    });
  });
});

// ============================================================
// convertToLocalPath
// ============================================================
describe('convertToLocalPath', () => {
  // Tests mock process.platform to simulate different OS environments.
  // The mock profile path is also platform-aware.

  describe('when platform is Windows', () => {
    beforeEach(() => mockPlatform('win32'));

    it('should convert macOS profile path to local path', () => {
      const macPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123';
      const result = convertToLocalPath(macPath, 'john_ms');
      
      // Should contain the local profile dir and relative path
      expect(result).toContain('testuser');
      expect(result).toContain('john_ms');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('chat_123');
      // Should not contain the original macOS path components
      expect(result).not.toContain('/Users/john');
    });

    it('should convert Linux profile path to local path', () => {
      const linuxPath = '/home/john/.config/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123/knowledge';
      const result = convertToLocalPath(linuxPath, 'john_ms');
      
      expect(result).toContain('testuser');
      expect(result).toContain('john_ms');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('knowledge');
      expect(result).not.toContain('/home/john');
    });

    it('should return native Windows path unchanged', () => {
      const winPath = 'C:\\Users\\john\\AppData\\Roaming\\openkosmos-app\\profiles\\john_ms\\chat_workspaces\\chat_123';
      const result = convertToLocalPath(winPath, 'john_ms');
      
      expect(result).toBe(winPath);
    });

    it('should return non-profile Unix path unchanged (cannot extract relative path)', () => {
      const unixPath = '/Users/john/Documents/some-file.txt';
      const result = convertToLocalPath(unixPath, 'john_ms');
      
      expect(result).toBe(unixPath);
    });
  });

  describe('when platform is macOS/Linux', () => {
    it('should detect Windows path as foreign when platform is darwin', () => {
      mockPlatform('darwin');
      const winPath = 'C:\\Users\\john\\AppData\\Roaming\\openkosmos-app\\profiles\\john_ms\\chat_workspaces\\chat_123';
      
      // Should convert because it's detected as foreign
      const result = convertToLocalPath(winPath, 'john_ms');
      
      // Result should use local profile dir (from mock) and contain relative path
      expect(result).toContain('testuser');
      expect(result).toContain('john_ms');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('chat_123');
    });

    it('should detect Windows path as foreign when platform is linux', () => {
      mockPlatform('linux');
      const winPath = 'C:\\Users\\john\\AppData\\Roaming\\openkosmos-app\\profiles\\john_ms\\chat_workspaces\\chat_123';
      
      const result = convertToLocalPath(winPath, 'john_ms');
      
      expect(result).toContain('testuser');
      expect(result).toContain('john_ms');
      expect(result).toContain('chat_workspaces');
    });

    it('should NOT detect Unix path as foreign when platform is darwin', () => {
      mockPlatform('darwin');
      const unixPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123';
      
      // Should NOT convert because Unix path is native on darwin
      const result = convertToLocalPath(unixPath, 'john_ms');
      
      expect(result).toBe(unixPath);
    });

    it('should return non-profile Windows path unchanged even when detected as foreign', () => {
      mockPlatform('darwin');
      const winPath = 'C:\\Users\\john\\Documents\\some-file.txt';
      
      // Foreign OS but not a profile path, so unchanged
      const result = convertToLocalPath(winPath, 'john_ms');
      
      expect(result).toBe(winPath);
    });
  });

  describe('alias handling', () => {
    beforeEach(() => mockPlatform('win32'));

    it('should return path unchanged when alias does not match expectedAlias', () => {
      // Path contains different alias than expectedAlias
      const unixPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/old_alias/chat_workspaces/chat_123';
      const result = convertToLocalPath(unixPath, 'new_alias');
      
      // Should return unchanged because alias mismatch
      expect(result).toBe(unixPath);
    });

    it('should handle alias with underscores', () => {
      const unixPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_org/chat_workspaces/chat_123';
      const result = convertToLocalPath(unixPath, 'john_org');

      expect(result).toContain('john_org');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('chat_123');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => mockPlatform('win32'));

    it('should return null for null input', () => {
      expect(convertToLocalPath(null as any, 'alias')).toBe(null);
    });

    it('should return undefined for undefined input', () => {
      expect(convertToLocalPath(undefined as any, 'alias')).toBe(undefined);
    });

    it('should return empty string for empty string input', () => {
      expect(convertToLocalPath('', 'alias')).toBe('');
    });

    it('should handle deeply nested paths', () => {
      const macPath = '/Users/john/Library/Application Support/openkosmos-app/profiles/john_ms/chat_workspaces/chat_123/knowledge/subdir/file.txt';
      const result = convertToLocalPath(macPath, 'john_ms');
      
      expect(result).toContain('testuser');
      expect(result).toContain('john_ms');
      expect(result).toContain('chat_workspaces');
      expect(result).toContain('chat_123');
      expect(result).toContain('knowledge');
      expect(result).toContain('subdir');
      expect(result).toContain('file.txt');
    });
  });
});


