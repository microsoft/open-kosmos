/**
 * Unit tests for ContextCompressionLlmSummarizer
 * Tests the real (non-mocked) static methods and verifies configuration constants.
 */

import { ContextCompressionLlmSummarizer } from '../contextCompressionLlmSummarizer';
import { TokenCounter } from '../../token';

// Mock ghcModelApi to prevent real API calls
vi.mock('../ghcModelApi', () => ({
  ghcModelApi: {
    callModel: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../unifiedLogger', () => ({
  getGlobalLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ghcModelApi } from '../ghcModelApi';

describe('ContextCompressionLlmSummarizer', () => {
  const tokenCounter = new TokenCounter({ enableCache: true, encoding: 'o200k_base' });

  describe('configuration constants', () => {
    it('uses claude-haiku-4.5 model', async () => {
      const mockCallModel = vi.mocked(ghcModelApi.callModel);
      mockCallModel.mockResolvedValueOnce('test summary');

      await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'hello world',
        maxRetries: 1,
      });

      expect(mockCallModel).toHaveBeenCalledWith(
        'claude-haiku-4.5',
        expect.any(String),
        expect.any(String),
        16000,  // MAX_TOKENS — our change from 5096 → 16000
        0.3,    // TEMPERATURE
      );
    });

    it('passes MAX_TOKENS=16000 to callModel', async () => {
      const mockCallModel = vi.mocked(ghcModelApi.callModel);
      mockCallModel.mockResolvedValueOnce('summary result');

      await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test content',
        maxRetries: 1,
      });

      const callArgs = mockCallModel.mock.calls[0];
      expect(callArgs[3]).toBe(16000); // 4th arg is maxTokens
    });
  });

  describe('buildPrompt', () => {
    it('includes conversation text in the prompt', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('my conversation content');
      expect(prompt).toContain('my conversation content');
    });

    it('includes the 8-section summary template', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('test');
      expect(prompt).toContain('Conversation Overview');
      expect(prompt).toContain('Resource Foundation');
      expect(prompt).toContain('Continuation Plan');
    });

    it('returns empty prompt content when given empty string', () => {
      const prompt = ContextCompressionLlmSummarizer.buildPrompt('');
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0); // template still present
    });
  });

  describe('getPromptOverheadTokens', () => {
    it('returns a positive number representing fixed prompt overhead', () => {
      const overhead = ContextCompressionLlmSummarizer.getPromptOverheadTokens(tokenCounter);
      expect(overhead).toBeGreaterThan(0);
      // Template + system prompt should be at least a few hundred tokens
      expect(overhead).toBeGreaterThan(200);
    });

    it('overhead is less than summaryPromptTokenBudget (100K)', () => {
      const overhead = ContextCompressionLlmSummarizer.getPromptOverheadTokens(tokenCounter);
      expect(overhead).toBeLessThan(100000);
    });

    it('estimateRequestTokens grows with conversation text length', () => {
      const shortEstimate = ContextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, 'short');
      const longEstimate = ContextCompressionLlmSummarizer.estimateRequestTokens(tokenCounter, 'a'.repeat(10000));
      expect(longEstimate).toBeGreaterThan(shortEstimate);
    });
  });

  describe('summarize — retry and error handling', () => {
    beforeEach(() => {
      vi.mocked(ghcModelApi.callModel).mockReset();
    });

    it('returns success on first attempt when API succeeds', async () => {
      vi.mocked(ghcModelApi.callModel).mockResolvedValueOnce('Generated summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Generated summary');
      expect(result.attempts).toBe(1);
    });

    it('retries on failure and succeeds on second attempt', async () => {
      vi.mocked(ghcModelApi.callModel)
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce('Recovered summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Recovered summary');
      expect(result.attempts).toBe(2);
    });

    it('returns failure after exhausting all retries', async () => {
      vi.mocked(ghcModelApi.callModel)
        .mockRejectedValue(new Error('Persistent failure'));

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.error).toContain('Persistent failure');
    });

    it('treats empty response as error and retries', async () => {
      vi.mocked(ghcModelApi.callModel)
        .mockResolvedValueOnce('   ')  // whitespace-only = empty after trim
        .mockResolvedValueOnce('Valid summary');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 2,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Valid summary');
      expect(result.attempts).toBe(2);
    });

    it('respects maxRetries=1 with no retry', async () => {
      vi.mocked(ghcModelApi.callModel)
        .mockRejectedValueOnce(new Error('fail'));

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(ghcModelApi.callModel).toHaveBeenCalledTimes(1);
    });

    it('defaults maxRetries to 3 when not provided', async () => {
      // Branch: params.maxRetries ?? 3 — cover the undefined case
      vi.mocked(ghcModelApi.callModel).mockResolvedValueOnce('summary without retries param');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test without maxRetries',
        // maxRetries omitted — defaults to 3
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('summary without retries param');
    });

    it('captures non-Error thrown values as error objects', async () => {
      // Branch: error instanceof Error ? error : new Error(String(error))
      vi.mocked(ghcModelApi.callModel).mockRejectedValueOnce('string error, not an Error');

      const result = await ContextCompressionLlmSummarizer.summarize({
        conversationText: 'test',
        maxRetries: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });
});
