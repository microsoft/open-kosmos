import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
}));

import {
  OpenKosmosPlaceholder,
  OpenKosmos_PLACEHOLDER_REGEX,
  containsOpenKosmosPlaceholder,
  extractOpenKosmosPlaceholders,
  OpenKosmosPlaceholderManager,
  kosmosPlaceholderManager,
} from '../kosmosPlaceholders';

describe('kosmosPlaceholders', () => {
  describe('containsOpenKosmosPlaceholder', () => {
    it('returns true for string containing a placeholder', () => {
      expect(containsOpenKosmosPlaceholder('prefix @OpenKosmos_PROFILE_WORKSPACES_FOLDER suffix')).toBe(true);
    });

    it('returns false for string without placeholder', () => {
      expect(containsOpenKosmosPlaceholder('just a normal string')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(containsOpenKosmosPlaceholder(null as any)).toBe(false);
      expect(containsOpenKosmosPlaceholder(undefined as any)).toBe(false);
      expect(containsOpenKosmosPlaceholder(123 as any)).toBe(false);
    });
  });

  describe('extractOpenKosmosPlaceholders', () => {
    it('returns all placeholders in string', () => {
      const result = extractOpenKosmosPlaceholders('@OpenKosmos_PROFILE_WORKSPACES_FOLDER');
      expect(result).toContain('@OpenKosmos_PROFILE_WORKSPACES_FOLDER');
    });

    it('deduplicates multiple occurrences', () => {
      const result = extractOpenKosmosPlaceholders(
        '@OpenKosmos_PROFILE_WORKSPACES_FOLDER and @OpenKosmos_PROFILE_WORKSPACES_FOLDER',
      );
      expect(result).toHaveLength(1);
    });

    it('returns empty array for non-string', () => {
      expect(extractOpenKosmosPlaceholders(null as any)).toEqual([]);
    });

    it('returns empty array when no placeholder found', () => {
      expect(extractOpenKosmosPlaceholders('no placeholder here')).toEqual([]);
    });
  });

  describe('OpenKosmosPlaceholderManager.getInstance', () => {
    it('returns singleton instance', () => {
      const a = OpenKosmosPlaceholderManager.getInstance();
      const b = OpenKosmosPlaceholderManager.getInstance();
      expect(a).toBe(b);
    });

    it('exported singleton equals getInstance()', () => {
      expect(kosmosPlaceholderManager).toBe(OpenKosmosPlaceholderManager.getInstance());
    });
  });

  describe('getPlaceholderValue', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('returns null when alias is missing', () => {
      expect(mgr.getPlaceholderValue('@OpenKosmos_PROFILE_WORKSPACES_FOLDER', { alias: '' })).toBeNull();
    });

    it('resolves PROFILE_WORKSPACES_FOLDER', () => {
      const val = mgr.getPlaceholderValue('@OpenKosmos_PROFILE_WORKSPACES_FOLDER', { alias: 'alice' });
      expect(typeof val).toBe('string');
      expect(val).toContain('profiles');
      expect(val).toContain('alice');
    });

    it('returns null for unknown placeholder', () => {
      const val = mgr.getPlaceholderValue('@OpenKosmos_UNKNOWN_THING', { alias: 'alice' });
      expect(val).toBeNull();
    });
  });

  describe('formatValueForPlatform', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('returns value unchanged when isPath is false', () => {
      expect(mgr.formatValueForPlatform('/some/path', false)).toBe('/some/path');
    });

    it('returns formatted path when isPath is true', () => {
      const result = mgr.formatValueForPlatform('/some/path', true);
      expect(typeof result).toBe('string');
    });
  });

  describe('replacePlaceholders', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('keeps unknown placeholders as-is', () => {
      const result = mgr.replacePlaceholders('@OpenKosmos_UNKNOWN_PLACEHOLDER', { alias: 'alice' });
      expect(result).toBe('@OpenKosmos_UNKNOWN_PLACEHOLDER');
    });

    it('replaces PROFILE_WORKSPACES_FOLDER with a real path', () => {
      const result = mgr.replacePlaceholders('@OpenKosmos_PROFILE_WORKSPACES_FOLDER', { alias: 'alice' });
      expect(result).toContain('alice');
    });

    it('returns non-string unchanged', () => {
      expect(mgr.replacePlaceholders(42 as any, { alias: 'alice' })).toBe(42);
    });
  });

  describe('replacePlaceholdersInObject', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('replaces placeholders in object string values', () => {
      const result = mgr.replacePlaceholdersInObject(
        { path: '@OpenKosmos_PROFILE_WORKSPACES_FOLDER', other: 'static' },
        { alias: 'alice' },
      );
      expect(result.path).toContain('alice');
      expect(result.other).toBe('static');
    });

    it('handles nested objects', () => {
      const result = mgr.replacePlaceholdersInObject(
        { nested: { path: '@OpenKosmos_PROFILE_WORKSPACES_FOLDER' } },
        { alias: 'alice' },
      );
      expect(result.nested.path).toContain('alice');
    });

    it('preserves non-string values', () => {
      const result = mgr.replacePlaceholdersInObject(
        { num: 42, bool: true, str: 'hello' } as any,
        { alias: 'alice' },
      );
      expect(result.num).toBe(42);
      expect(result.bool).toBe(true);
    });

    it('returns non-object unchanged', () => {
      expect(mgr.replacePlaceholdersInObject(null as any, { alias: 'alice' })).toBeNull();
    });
  });

  describe('getSupportedPlaceholders', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('returns array of supported placeholders with name and description', () => {
      const result = mgr.getSupportedPlaceholders();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      for (const item of result) {
        expect(typeof item.name).toBe('string');
        expect(typeof item.description).toBe('string');
      }
    });

    it('includes PROFILE_WORKSPACES_FOLDER', () => {
      const result = mgr.getSupportedPlaceholders();
      const names = result.map(p => p.name);
      expect(names).toContain('@OpenKosmos_PROFILE_WORKSPACES_FOLDER');
    });
  });
});
