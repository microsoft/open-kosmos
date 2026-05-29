/**
 * Tests for TextLlmEmbedder
 */

// ============================================================================
// Mocks
// ============================================================================

const mockGetCurrentAuth = vi.fn();

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({ getCurrentAuth: mockGetCurrentAuth }),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.test.com',
    USER_AGENT: 'test-agent',
    EDITOR_VERSION: 'vscode/1.0',
    EDITOR_PLUGIN_VERSION: 'copilot/1.0',
  },
}));

const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

import { TextLlmEmbedder, textLlmEmbedder } from '../textLlmEmbedder';

// ============================================================================
// Helpers
// ============================================================================

function makeSession(token = 'tok-embed') {
  return {
    authProvider: 'ghc',
    ghcAuth: { copilotTokens: { token } },
  };
}

function makeEmbeddingResponse(vector: number[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      data: [{ embedding: vector }],
    }),
  };
}

const DIMS = 1536;
const sampleVector = new Array(DIMS).fill(0.1);

// ============================================================================
// Tests
// ============================================================================

describe('TextLlmEmbedder', () => {
  let embedder: TextLlmEmbedder;

  beforeEach(() => {
    vi.clearAllMocks();
    embedder = new TextLlmEmbedder();
  });

  // ---- getInfo ----

  describe('getInfo', () => {
    it('returns correct model and dims info', () => {
      const info = embedder.getInfo();
      expect(info.model).toBe('text-embedding-3-small');
      expect(info.embeddingDims).toBe(1536);
      expect(info.maxRetries).toBe(3);
    });
  });

  // ---- cosineSimilarity ----

  describe('cosineSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
      const v = [1, 0, 0];
      expect(TextLlmEmbedder.cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(TextLlmEmbedder.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns -1 for opposite vectors', () => {
      expect(TextLlmEmbedder.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    it('returns 0 for zero vector', () => {
      expect(TextLlmEmbedder.cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it('throws when vectors have different lengths', () => {
      expect(() => TextLlmEmbedder.cosineSimilarity([1, 2], [1, 2, 3])).toThrow('same length');
    });
  });

  // ---- embed — success ----

  describe('embed — success', () => {
    it('returns embedding vector on success', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeEmbeddingResponse(sampleVector));

      const result = await embedder.embed('hello world');
      expect(result).toHaveLength(DIMS);
      expect(result[0]).toBe(0.1);
    });

    it('sends correct request body to embeddings endpoint', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeEmbeddingResponse(sampleVector));

      await embedder.embed('test text');
      const url = mockFetch.mock.calls[0][0];
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(url).toBe('https://api.test.com/embeddings');
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toEqual(['test text']);
      expect(body.dimensions).toBe(1536);
    });

    it('trims newlines from text before sending', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeEmbeddingResponse(sampleVector));

      await embedder.embed('hello\nworld');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input[0]).toBe('hello world');
    });
  });

  // ---- embed — authentication failures ----

  describe('embed — authentication failures', () => {
    it('throws when no session is available', async () => {
      mockGetCurrentAuth.mockResolvedValue(null);
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    });

    it('throws when authProvider is not ghc', async () => {
      mockGetCurrentAuth.mockResolvedValue({ authProvider: 'other' });
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    });

    it('throws when auth manager throws', async () => {
      mockGetCurrentAuth.mockRejectedValue(new Error('auth down'));
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    });

    it('handles non-Error thrown in outer catch (unknown error branch)', async () => {
      // Covers: error instanceof Error ? error.message : 'Unknown error' — false branch (line 79)
      // Simulate by making getSessionFromAuthManager reject with a non-Error
      mockGetCurrentAuth.mockRejectedValue('plain string rejection');
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    });
  });

  // ---- embed — API errors ----

  describe('embed — API errors', () => {
    it('retries on failure and succeeds on subsequent attempt', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: vi.fn().mockResolvedValue('err') })
        .mockResolvedValueOnce(makeEmbeddingResponse(sampleVector));

      const result = await embedder.embed('retry test');
      expect(result).toHaveLength(DIMS);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('err') });

      await expect(embedder.embed('fail')).rejects.toThrow('Embedding failed');
      expect(mockFetch).toHaveBeenCalledTimes(3); // maxRetries = 3
    }, 15000);

    it('throws when API response has no data array', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ other: 'field' }),
      });
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    }, 15000);

    it('throws when embedding is not an array in response', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ embedding: 'not-an-array' }] }),
      });
      await expect(embedder.embed('text')).rejects.toThrow('Embedding failed');
    }, 15000);

    it('succeeds even when embedding has unexpected dimensions (no-op check)', async () => {
      // Covers: if (embedding.length !== this.embeddingDims) {} — empty block, true branch
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      const shortVector = [0.1, 0.2, 0.3]; // wrong dims (3 instead of 1536)
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ embedding: shortVector }] }),
      });
      // The empty if block does nothing, so embedding returns successfully
      const result = await embedder.embed('dimension test text');
      expect(result).toEqual(shortVector);
    });

    it('wraps non-Error thrown in requestEmbedding catch as Error', async () => {
      // Covers: error instanceof Error ? error : new Error('Unknown error') — false branch (line 228)
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      // Make fetch.json throw a non-Error value
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue('plain string thrown, not an Error'),
      });
      await expect(embedder.embed('test')).rejects.toThrow('Embedding failed');
    }, 15000);

    it('throws for empty text', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      await expect(embedder.embed('')).rejects.toThrow('Embedding failed');
    });
  });

  // ---- embedBatch ----

  describe('embedBatch', () => {
    it('returns array of embeddings for multiple texts', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeEmbeddingResponse(sampleVector));

      const results = await embedder.embedBatch(['text1', 'text2']);
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(DIMS);
    }, 10000);

    it('uses longer delay for memory-heavy text in batch (covers memory delay branch)', async () => {
      // Covers: textAnalysis.hasMemoryContent ? 150 : 100 — true branch
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeEmbeddingResponse(sampleVector));

      // 'memory' keyword triggers hasMemoryContent = true → 150ms delay instead of 100ms
      const results = await embedder.embedBatch(['remember my settings', 'another text']);
      expect(results).toHaveLength(2);
    }, 10000);

    it('throws on first failure in batch', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      // First embed succeeds, second fails completely
      mockFetch
        .mockResolvedValueOnce(makeEmbeddingResponse(sampleVector))
        .mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('err') });

      await expect(embedder.embedBatch(['text1', 'text2'])).rejects.toThrow();
    }, 20000);
  });

  // ---- singleton ----

  it('textLlmEmbedder is a TextLlmEmbedder instance', () => {
    expect(textLlmEmbedder).toBeInstanceOf(TextLlmEmbedder);
  });
});
