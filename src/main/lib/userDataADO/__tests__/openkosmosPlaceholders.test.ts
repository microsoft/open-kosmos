import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
}));

import * as os from 'os';
import {
  OpenKosmosPlaceholder,
  PlaceholderType,
  OPENKOSMOS_PLACEHOLDER_REGEX,
  containsOpenKosmosPlaceholder,
  extractOpenKosmosPlaceholders,
  OpenKosmosPlaceholderManager,
  openkosmosPlaceholderManager,
} from '../openkosmosPlaceholders';

describe('openkosmosPlaceholders', () => {
  const credentialEnvKeys = [
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'DATA_AI_API_KEY',
    'UNWRAP_ACCESS_TOKEN',
    'TAVILY_API_KEY',
  ] as const;
  const originalCredentialEnv = new Map(
    credentialEnvKeys.map(key => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of credentialEnvKeys) {
      const originalValue = originalCredentialEnv.get(key);
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  describe('containsOpenKosmosPlaceholder', () => {
    it('returns true for string containing a placeholder', () => {
      expect(containsOpenKosmosPlaceholder('prefix @OPENKOSMOS_PROFILE_WORKSPACES_FOLDER suffix')).toBe(true);
    });

    it('returns false for string without placeholder', () => {
      expect(containsOpenKosmosPlaceholder('just a normal string')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(containsOpenKosmosPlaceholder(null as any)).toBe(false);
      expect(containsOpenKosmosPlaceholder(undefined as any)).toBe(false);
      expect(containsOpenKosmosPlaceholder(123 as any)).toBe(false);
    });

    it('does not miss repeated checks because of global regex state', () => {
      const value = '@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER';
      expect(containsOpenKosmosPlaceholder(value)).toBe(true);
      expect(containsOpenKosmosPlaceholder(value)).toBe(true);
    });
  });

  describe('extractOpenKosmosPlaceholders', () => {
    it('returns all placeholders in string', () => {
      const result = extractOpenKosmosPlaceholders(
        '@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER and @OPENKOSMOS_HOME',
      );
      expect(result).toContain('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER');
      expect(result).toContain('@OPENKOSMOS_HOME');
    });

    it('deduplicates multiple occurrences', () => {
      const result = extractOpenKosmosPlaceholders(
        '@OPENKOSMOS_HOME and @OPENKOSMOS_HOME',
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
      expect(openkosmosPlaceholderManager).toBe(OpenKosmosPlaceholderManager.getInstance());
    });
  });

  describe('getPlaceholderValue', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('returns null when alias is missing', () => {
      expect(mgr.getPlaceholderValue('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER', { alias: '' })).toBeNull();
    });

    it('resolves PROFILE_WORKSPACES_FOLDER', () => {
      const val = mgr.getPlaceholderValue('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER', { alias: 'alice' });
      expect(typeof val).toBe('string');
      expect(val).toContain('profiles');
      expect(val).toContain('alice');
    });

    it('returns null for unknown placeholder', () => {
      const val = mgr.getPlaceholderValue('@OPENKOSMOS_UNKNOWN_THING', { alias: 'alice' });
      expect(val).toBeNull();
    });

    it('resolves credential placeholders from environment variables', () => {
      process.env.REDDIT_CLIENT_ID = 'reddit-id';
      process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
      process.env.DATA_AI_API_KEY = 'data-ai-key';
      process.env.UNWRAP_ACCESS_TOKEN = 'unwrap-token';
      process.env.TAVILY_API_KEY = 'tavily-key';

      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.REDDIT_CLIENT_ID, { alias: 'alice' })).toBe('reddit-id');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.REDDIT_CLIENT_SECRET, { alias: 'alice' })).toBe('reddit-secret');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.DATA_AI_API_KEY, { alias: 'alice' })).toBe('data-ai-key');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.UNWRAP_ACCESS_TOKEN, { alias: 'alice' })).toBe('unwrap-token');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.TAVILY_API_KEY, { alias: 'alice' })).toBe('tavily-key');
    });

    it('resolves missing credential environment variables to empty strings', () => {
      for (const key of credentialEnvKeys) {
        delete process.env[key];
      }

      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.REDDIT_CLIENT_ID, { alias: 'alice' })).toBe('');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.REDDIT_CLIENT_SECRET, { alias: 'alice' })).toBe('');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.DATA_AI_API_KEY, { alias: 'alice' })).toBe('');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.UNWRAP_ACCESS_TOKEN, { alias: 'alice' })).toBe('');
      expect(mgr.getPlaceholderValue(OpenKosmosPlaceholder.TAVILY_API_KEY, { alias: 'alice' })).toBe('');
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

    it('replaces a known placeholder', () => {
      const result = mgr.replacePlaceholders('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER', { alias: 'alice' });
      expect(result).toContain('alice');
    });

    it('keeps unknown placeholders as-is', () => {
      const result = mgr.replacePlaceholders('@OPENKOSMOS_UNKNOWN_PLACEHOLDER', { alias: 'alice' });
      expect(result).toBe('@OPENKOSMOS_UNKNOWN_PLACEHOLDER');
    });

    it('keeps unknown placeholders embedded in non-path strings as-is', () => {
      const result = mgr.replacePlaceholders('token=@OPENKOSMOS_UNKNOWN_PLACEHOLDER', { alias: 'alice' });
      expect(result).toBe('token=@OPENKOSMOS_UNKNOWN_PLACEHOLDER');
    });

    it('replaces PROFILE_WORKSPACES_FOLDER with a real path', () => {
      const result = mgr.replacePlaceholders('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER', { alias: 'alice' });
      expect(result).toContain('alice');
    });

    it('returns non-string unchanged', () => {
      expect(mgr.replacePlaceholders(42 as any, { alias: 'alice' })).toBe(42);
    });

    it('replaces credential placeholders in MCP env values', () => {
      process.env.REDDIT_CLIENT_ID = 'reddit-id';
      process.env.DATA_AI_API_KEY = 'data-ai-key';

      const result = mgr.replacePlaceholdersInObject(
        {
          REDDIT_CLIENT_ID: '@OPENKOSMOS_REDDIT_CLIENT_ID',
          DATA_AI_API_KEY: '@OPENKOSMOS_DATA_AI_API_KEY',
        },
        { alias: 'alice' },
      );

      expect(result).toEqual({
        REDDIT_CLIENT_ID: 'reddit-id',
        DATA_AI_API_KEY: 'data-ai-key',
      });
    });
  });

  describe('replacePlaceholdersInObject', () => {
    const mgr = OpenKosmosPlaceholderManager.getInstance();

    it('replaces placeholders in object string values', () => {
      const result = mgr.replacePlaceholdersInObject(
        { key: '@OPENKOSMOS_HOME', other: 'static' },
        { alias: 'alice' },
      );
      expect(typeof result.key).toBe('string');
      expect(result.other).toBe('static');
    });

    it('handles nested objects', () => {
      const result = mgr.replacePlaceholdersInObject(
        { nested: { key: '@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER' } },
        { alias: 'alice' },
      );
      expect(result.nested.key).toContain('alice');
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
      expect(names).toContain('@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER');
    });

    it('includes credential placeholders', () => {
      const result = mgr.getSupportedPlaceholders();
      const names = result.map(p => p.name);
      expect(names).toEqual(expect.arrayContaining([
        '@OPENKOSMOS_REDDIT_CLIENT_ID',
        '@OPENKOSMOS_REDDIT_CLIENT_SECRET',
        '@OPENKOSMOS_DATA_AI_API_KEY',
        '@OPENKOSMOS_UNWRAP_ACCESS_TOKEN',
        '@OPENKOSMOS_TAVILY_API_KEY',
      ]));
    });
  });
});
