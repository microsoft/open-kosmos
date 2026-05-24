/**
 * Tests for SystemPromptLlmWriter
 */

// ============================================================================
// Mocks
// ============================================================================

const mockCallModel = vi.fn();

vi.mock('../ghcModelApi', () => ({
  ghcModelApi: { callModel: (...args: any[]) => mockCallModel(...args) },
}));

import {
  SystemPromptLlmWriter,
  systemPromptLlmWriter,
} from '../systemPromptLlmWritter';

// ============================================================================
// Tests
// ============================================================================

describe('SystemPromptLlmWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- getDefaultParams ----

  describe('getDefaultParams', () => {
    it('returns expected defaults', () => {
      const params = SystemPromptLlmWriter.getDefaultParams();
      expect(params.name).toBe('system prompt improvement');
      expect(params.maxTokens).toBe(1000);
      expect(params.temperature).toBe(0.7);
    });
  });

  // ---- getUsageGuide ----

  describe('getUsageGuide', () => {
    it('returns a guide with title, examples, and tips', () => {
      const guide = SystemPromptLlmWriter.getUsageGuide();
      expect(guide.title).toBeTruthy();
      expect(Array.isArray(guide.examples)).toBe(true);
      expect(Array.isArray(guide.tips)).toBe(true);
    });
  });

  // ---- validateWriterResponse ----

  describe('validateWriterResponse', () => {
    it('returns false when success is false', () => {
      expect(SystemPromptLlmWriter.validateWriterResponse({ success: false })).toBe(false);
    });

    it('returns false when success=true but improvedPrompt is missing', () => {
      expect(SystemPromptLlmWriter.validateWriterResponse({ success: true })).toBe(false);
    });

    it('returns false when improvedPrompt is only whitespace', () => {
      expect(SystemPromptLlmWriter.validateWriterResponse({
        success: true,
        improvedPrompt: '   ',
      })).toBe(false);
    });

    it('returns true when improvedPrompt is only whitespace but warnings are present', () => {
      // Covers: !improvedPrompt.trim() → return !!(warnings && warnings.length > 0) — true branch
      expect(SystemPromptLlmWriter.validateWriterResponse({
        success: true,
        improvedPrompt: '   ',
        warnings: ['some warning present'],
      })).toBe(true);
    });

    it('returns true when improvedPrompt has no markdown headings (no-op branch)', () => {
      // Covers: !includes('#') && !includes('##') — the no-op block is traversed
      expect(SystemPromptLlmWriter.validateWriterResponse({
        success: true,
        improvedPrompt: 'Improved prompt without any markdown headings at all',
      })).toBe(true);
    });

    it('returns false when improvedPrompt equals originalPrompt', () => {
      expect(SystemPromptLlmWriter.validateWriterResponse({
        success: true,
        improvedPrompt: 'same',
        originalPrompt: 'same',
      })).toBe(false);
    });

    it('returns true (with warnings) when success=true, no improvedPrompt, but has warnings', () => {
      expect(SystemPromptLlmWriter.validateWriterResponse({
        success: true,
        warnings: ['some warning'],
      })).toBe(true);
    });
  });

  // ---- improveSystemPrompt — input validation ----

  describe('improveSystemPrompt — input validation', () => {
    it('returns failure for empty input', async () => {
      const result = await SystemPromptLlmWriter.improveSystemPrompt('');
      expect(result.success).toBe(false);
      expect(result.warnings).toBeDefined();
    });

    it('returns failure for very short input (< 3 chars)', async () => {
      const result = await SystemPromptLlmWriter.improveSystemPrompt('ab');
      expect(result.success).toBe(false);
    });

    it('returns failure for whitespace-only input', async () => {
      const result = await SystemPromptLlmWriter.improveSystemPrompt('   ');
      expect(result.success).toBe(false);
    });
  });

  // ---- improveSystemPrompt — LLM happy path ----

  describe('improveSystemPrompt — LLM happy path', () => {
    it('parses clean JSON response and returns improved prompt', async () => {
      const raw = JSON.stringify({
        success: true,
        improvedPrompt: '# Identity\nYou are a coding assistant.',
        changeSummary: ['Added structure'],
        warnings: [],
        errors: [],
      });
      mockCallModel.mockResolvedValue(raw);

      const result = await SystemPromptLlmWriter.improveSystemPrompt('You are a coding assistant. Be helpful.');
      expect(result.success).toBe(true);
      expect(result.improvedPrompt).toBe('# Identity\nYou are a coding assistant.');
      expect(result.rawResponse).toBe(raw);
      expect(result.originalPrompt).toBe('You are a coding assistant. Be helpful.');
    });

    it('strips markdown code blocks before parsing', async () => {
      const payload = { success: true, improvedPrompt: 'Polished', changeSummary: [], warnings: [], errors: [] };
      mockCallModel.mockResolvedValue('```json\n' + JSON.stringify(payload) + '\n```');

      const result = await SystemPromptLlmWriter.improveSystemPrompt('Be a helpful assistant.');
      expect(result.success).toBe(true);
      expect(result.improvedPrompt).toBe('Polished');
    });

    it('extracts JSON embedded in surrounding text', async () => {
      const payload = { success: true, improvedPrompt: 'Extracted', changeSummary: [], warnings: [], errors: [] };
      mockCallModel.mockResolvedValue('Some preamble. ' + JSON.stringify(payload) + ' Some postamble.');

      const result = await SystemPromptLlmWriter.improveSystemPrompt('Draft system prompt here.');
      expect(result.success).toBe(true);
      expect(result.improvedPrompt).toBe('Extracted');
    });
  });

  // ---- improveSystemPrompt — error paths ----

  describe('improveSystemPrompt — error paths', () => {
    it('returns parse error response when JSON is invalid', async () => {
      mockCallModel.mockResolvedValue('not json!!!');
      const result = await SystemPromptLlmWriter.improveSystemPrompt('A valid system prompt draft.');
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('returns error when API throws', async () => {
      mockCallModel.mockRejectedValue(new Error('API down'));
      const result = await SystemPromptLlmWriter.improveSystemPrompt('A valid system prompt draft.');
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('API down');
    });
  });

  // ---- module-level export ----

  it('systemPromptLlmWriter is the class itself', () => {
    expect(systemPromptLlmWriter).toBe(SystemPromptLlmWriter);
  });
});
