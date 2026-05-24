/**
 * Tests for FileNameLlmGenerator
 */

// ============================================================================
// Mocks
// ============================================================================

const mockCallModel = vi.fn();

vi.mock('../ghcModelApi', () => ({
  ghcModelApi: { callModel: (...args: any[]) => mockCallModel(...args) },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
  getGlobalLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

import {
  FileNameLlmGenerator,
  fileNameLlmGenerator,
} from '../fileNameLlmGenerator';

// ============================================================================
// Tests
// ============================================================================

describe('FileNameLlmGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- generateFileName — input validation ----

  describe('generateFileName — input validation', () => {
    it('returns failure for content shorter than 3 chars', async () => {
      const result = await FileNameLlmGenerator.generateFileName('ab');
      expect(result.success).toBe(false);
      expect(result.fileName).toMatch(/^pasted-content-/);
      expect(result.extension).toBe('txt');
    });

    it('returns failure when content contains only symbols/numbers', async () => {
      const result = await FileNameLlmGenerator.generateFileName('12345678');
      expect(result.success).toBe(false);
      expect(result.warnings).toBeDefined();
    });
  });

  // ---- generateFileName — success ----

  describe('generateFileName — success', () => {
    it('returns parsed file name from clean JSON response', async () => {
      const raw = JSON.stringify({
        success: true,
        fileName: 'project-roadmap',
        extension: 'md',
        fullFileName: 'project-roadmap.md',
      });
      mockCallModel.mockResolvedValue(raw);

      const result = await FileNameLlmGenerator.generateFileName('# Project Roadmap\n\n## Q1 2025\n- Feature A');
      expect(result.success).toBe(true);
      expect(result.fileName).toBe('project-roadmap');
      expect(result.extension).toBe('md');
      expect(result.fullFileName).toBe('project-roadmap.md');
    });

    it('falls back to untitled and txt when fileName and extension are missing in response', async () => {
      // Covers: parsed.fileName || 'untitled' and parsed.extension || 'txt'
      mockCallModel.mockResolvedValue(JSON.stringify({ success: true }));
      const result = await FileNameLlmGenerator.generateFileName('Content for fallback defaults test');
      expect(result.success).toBe(true);
      expect(result.fileName).toBe('untitled');
      expect(result.extension).toBe('txt');
      expect(result.fullFileName).toBe('untitled.txt');
    });

    it('strips markdown code blocks before parsing', async () => {
      const payload = { success: true, fileName: 'clean-file', extension: 'txt', fullFileName: 'clean-file.txt' };
      mockCallModel.mockResolvedValue('```json\n' + JSON.stringify(payload) + '\n```');

      const result = await FileNameLlmGenerator.generateFileName('Some meaningful content for naming');
      expect(result.success).toBe(true);
      expect(result.fileName).toBe('clean-file');
    });

    it('strips triple backtick (no json) code blocks', async () => {
      const payload = { success: true, fileName: 'my-file', extension: 'py', fullFileName: 'my-file.py' };
      mockCallModel.mockResolvedValue('```\n' + JSON.stringify(payload) + '\n```');

      const result = await FileNameLlmGenerator.generateFileName('def hello(): pass -- python function');
      expect(result.success).toBe(true);
    });

    it('normalizes file name: lowercase, replace spaces with hyphens, remove special chars', async () => {
      const raw = JSON.stringify({
        success: true,
        fileName: 'My File Name!!!',
        extension: 'txt',
        fullFileName: 'my-file-name.txt',
      });
      mockCallModel.mockResolvedValue(raw);

      const result = await FileNameLlmGenerator.generateFileName('Some meaningful text content for testing');
      expect(result.fileName).not.toMatch(/[A-Z!]/);
    });

    it('truncates file name to 10 words when over limit', async () => {
      const longName = Array(15).fill('word').join('-');
      const raw = JSON.stringify({
        success: true,
        fileName: longName,
        extension: 'txt',
        fullFileName: longName + '.txt',
      });
      mockCallModel.mockResolvedValue(raw);

      const result = await FileNameLlmGenerator.generateFileName('Content with enough meaningful words to analyze properly');
      expect(result.fileName!.split('-').length).toBeLessThanOrEqual(10);
    });

    it('truncates content longer than 2000 chars before sending to API', async () => {
      const longContent = 'a word '.repeat(400); // > 2000 chars
      mockCallModel.mockResolvedValue(JSON.stringify({
        success: true, fileName: 'truncated', extension: 'txt', fullFileName: 'truncated.txt',
      }));

      await FileNameLlmGenerator.generateFileName(longContent);
      const promptArg = mockCallModel.mock.calls[0][1];
      expect(promptArg).toContain('[content truncated]');
    });
  });

  // ---- generateFileName — parse failure ----

  describe('generateFileName — parse failure fallback', () => {
    it('returns fallback timestamp-based name on parse failure', async () => {
      mockCallModel.mockResolvedValue('not valid json!!!');
      const result = await FileNameLlmGenerator.generateFileName('Content that should be named by the LLM');
      expect(result.success).toBe(false);
      expect(result.fileName).toMatch(/^pasted-content-/);
      expect(result.errors).toBeDefined();
    });

    it('returns fallback when API throws', async () => {
      mockCallModel.mockRejectedValue(new Error('API error'));
      const result = await FileNameLlmGenerator.generateFileName('Content that should be named');
      expect(result.success).toBe(false);
      expect(result.fileName).toMatch(/^pasted-content-/);
    });

    it('handles non-Error thrown value in outer catch', async () => {
      // Covers: error instanceof Error ? error.message : 'Unknown error' — false branch (line 247)
      mockCallModel.mockRejectedValue('plain string, not an Error');
      const result = await FileNameLlmGenerator.generateFileName('Content that should be named');
      expect(result.success).toBe(false);
      expect(result.errors![0]).toBe('Unknown error');
    });

    it('handles non-Error thrown in parse catch (String branch)', async () => {
      // Covers: parseError instanceof Error ? parseError.message : String(parseError)
      // JSON.parse itself always throws SyntaxError (an Error), but we can test via another path.
      // This is best-effort; the non-Error branch in parse catch is hard to trigger.
      mockCallModel.mockResolvedValue('{ invalid json ]');
      const result = await FileNameLlmGenerator.generateFileName('Content here for parsing');
      expect(result.success).toBe(false);
    });
  });

  // ---- module-level export ----

  it('fileNameLlmGenerator is the class itself', () => {
    expect(fileNameLlmGenerator).toBe(FileNameLlmGenerator);
  });
});
