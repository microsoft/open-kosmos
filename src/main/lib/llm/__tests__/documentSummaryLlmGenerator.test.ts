/**
 * Tests for DocumentSummaryLlmGenerator
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
  DocumentSummaryLlmGenerator,
  documentSummaryLlmGenerator,
} from '../documentSummaryLlmGenerator';

// ============================================================================
// Tests
// ============================================================================

describe('DocumentSummaryLlmGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- generateSummary — input validation ----

  describe('generateSummary — input validation', () => {
    it('returns failure when content is empty', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', '');
      expect(result.success).toBe(false);
      expect(result.fileName).toBe('doc.txt');
      expect(result.warnings).toBeDefined();
    });

    it('returns failure when content is only whitespace', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', '   ');
      expect(result.success).toBe(false);
    });

    it('returns failure when content is shorter than 20 chars', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', 'short');
      expect(result.success).toBe(false);
      expect(result.warnings).toBeDefined();
    });
  });

  // ---- generateSummary — success ----

  describe('generateSummary — success', () => {
    it('returns success with summary on valid response', async () => {
      mockCallModel.mockResolvedValue('This document explains sorting algorithms.');

      const result = await DocumentSummaryLlmGenerator.generateSummary(
        'algorithms.pdf',
        'This is a detailed document about sorting algorithms including quicksort and mergesort.',
      );
      expect(result.success).toBe(true);
      expect(result.summary).toBe('This document explains sorting algorithms.');
      expect(result.fileName).toBe('algorithms.pdf');
    });

    it('passes truncated flag in user prompt', async () => {
      mockCallModel.mockResolvedValue('Summary here.');
      const content = 'A '.repeat(50); // > 20 chars

      await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, true);
      const promptArg = mockCallModel.mock.calls[0][1];
      expect(promptArg).toContain('truncated');
    });

    it('includes full in user prompt when not truncated', async () => {
      mockCallModel.mockResolvedValue('Summary here.');
      const content = 'A '.repeat(50);

      await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, false);
      const promptArg = mockCallModel.mock.calls[0][1];
      expect(promptArg).toContain('full');
    });
  });

  // ---- generateSummary — empty LLM response ----

  describe('generateSummary — empty LLM response', () => {
    it('returns failure when LLM returns empty string', async () => {
      mockCallModel.mockResolvedValue('   '); // whitespace → trim → empty
      const content = 'Content long enough to pass validation check at 20 chars';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  // ---- generateSummary — error handling ----

  describe('generateSummary — error handling', () => {
    it('returns failure with error message when API throws', async () => {
      mockCallModel.mockRejectedValue(new Error('Network timeout'));
      const content = 'Content that is long enough for validation to pass here.';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('Network timeout');
    });

    it('handles non-Error thrown value in catch (String branch)', async () => {
      // Covers: error instanceof Error ? ... : String(error) — false branch (line 115)
      mockCallModel.mockRejectedValue('plain string thrown, not an Error');
      const content = 'Content that is long enough for validation to pass here.';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('plain string thrown');
    });

    it('logs summary with ellipsis when summary is longer than 150 chars', async () => {
      // Covers: summary.length > 150 ? '...' : '' — true branch
      const longSummary = 'word '.repeat(40).trim(); // > 150 chars
      mockCallModel.mockResolvedValue(longSummary);

      const result = await DocumentSummaryLlmGenerator.generateSummary(
        'long.pdf',
        'Content that is long enough for validation to pass here.',
      );
      expect(result.success).toBe(true);
      expect(result.summary).toBe(longSummary);
    });
  });

  // ---- module-level export ----

  it('documentSummaryLlmGenerator is the class itself', () => {
    expect(documentSummaryLlmGenerator).toBe(DocumentSummaryLlmGenerator);
  });
});
