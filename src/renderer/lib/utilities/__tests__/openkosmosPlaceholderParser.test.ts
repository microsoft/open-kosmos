/**
 * @vitest-environment happy-dom
 */
import {
  containsOpenKosmosPlaceholder,
  hasOpenKosmosPlaceholdersInObject,
  extractOpenKosmosPlaceholders,
  replaceOpenKosmosPlaceholders,
  OPENKOSMOS_PLACEHOLDER_REGEX,
} from '../openkosmosPlaceholderParser';

describe('openkosmosPlaceholderParser', () => {
  describe('OPENKOSMOS_PLACEHOLDER_REGEX', () => {
    it('matches valid placeholders', () => {
      const matches = 'Use @OPENKOSMOS_WORKSPACE_FOLDER here'.match(new RegExp(OPENKOSMOS_PLACEHOLDER_REGEX.source, 'g'));
      expect(matches).toEqual(['@OPENKOSMOS_WORKSPACE_FOLDER']);
    });
  });

  describe('containsOpenKosmosPlaceholder', () => {
    it('returns true for string with placeholder', () => {
      expect(containsOpenKosmosPlaceholder('path/@OPENKOSMOS_PROFILE/data')).toBe(true);
    });

    it('returns false for string without placeholder', () => {
      expect(containsOpenKosmosPlaceholder('no placeholders here')).toBe(false);
    });

    it('returns false for non-string', () => {
      expect(containsOpenKosmosPlaceholder(123 as any)).toBe(false);
      expect(containsOpenKosmosPlaceholder(null as any)).toBe(false);
    });

    it('returns false for lowercase kosmos', () => {
      expect(containsOpenKosmosPlaceholder('@openkosmos_test')).toBe(false);
    });

    it('matches multiple placeholders', () => {
      expect(containsOpenKosmosPlaceholder('@OPENKOSMOS_A and @OPENKOSMOS_B')).toBe(true);
    });
  });

  describe('hasOpenKosmosPlaceholdersInObject', () => {
    it('returns true when a value contains placeholder', () => {
      expect(hasOpenKosmosPlaceholdersInObject({ key: '@OPENKOSMOS_PATH' })).toBe(true);
    });

    it('returns false when no values contain placeholders', () => {
      expect(hasOpenKosmosPlaceholdersInObject({ key: 'normal' })).toBe(false);
    });

    it('returns false for null/non-object', () => {
      expect(hasOpenKosmosPlaceholdersInObject(null as any)).toBe(false);
      expect(hasOpenKosmosPlaceholdersInObject(undefined as any)).toBe(false);
      expect(hasOpenKosmosPlaceholdersInObject('string' as any)).toBe(false);
    });

    it('ignores non-string values', () => {
      expect(hasOpenKosmosPlaceholdersInObject({ num: 123, bool: true })).toBe(false);
    });
  });

  describe('extractOpenKosmosPlaceholders', () => {
    it('extracts all unique placeholders', () => {
      const result = extractOpenKosmosPlaceholders('@OPENKOSMOS_A and @OPENKOSMOS_B and @OPENKOSMOS_A');
      expect(result).toEqual(['@OPENKOSMOS_A', '@OPENKOSMOS_B']);
    });

    it('returns empty array for no placeholders', () => {
      expect(extractOpenKosmosPlaceholders('no match')).toEqual([]);
    });

    it('returns empty array for non-string', () => {
      expect(extractOpenKosmosPlaceholders(null as any)).toEqual([]);
    });
  });

  describe('replaceOpenKosmosPlaceholders', () => {
    beforeEach(() => {
      (window as any).electronAPI = undefined;
    });

    it('returns original when no API available', async () => {
      const env = { PATH: '@OPENKOSMOS_DATA' };
      const result = await replaceOpenKosmosPlaceholders(env);
      expect(result).toBe(env);
    });

    it('returns replaced values on success', async () => {
      (window as any).electronAPI = {
        openkosmos: {
          replacePlaceholders: vi.fn().mockResolvedValue({
            success: true,
            data: { PATH: '/resolved/data' },
          }),
        },
      };
      const result = await replaceOpenKosmosPlaceholders({ PATH: '@OPENKOSMOS_DATA' });
      expect(result).toEqual({ PATH: '/resolved/data' });
    });

    it('returns original on API failure', async () => {
      (window as any).electronAPI = {
        openkosmos: {
          replacePlaceholders: vi.fn().mockResolvedValue({
            success: false,
            error: 'failed',
          }),
        },
      };
      const env = { PATH: '@OPENKOSMOS_DATA' };
      const result = await replaceOpenKosmosPlaceholders(env);
      expect(result).toBe(env);
    });

    it('returns original on exception', async () => {
      (window as any).electronAPI = {
        openkosmos: {
          replacePlaceholders: vi.fn().mockRejectedValue(new Error('crash')),
        },
      };
      const env = { PATH: '@OPENKOSMOS_DATA' };
      const result = await replaceOpenKosmosPlaceholders(env);
      expect(result).toBe(env);
    });
  });
});
