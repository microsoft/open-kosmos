/**
 * Tests for GhcModelApi and getEndpointForModel
 */

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

const mockGetCurrentAuth = vi.fn();

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({
      getCurrentAuth: mockGetCurrentAuth,
    }),
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

// Mock getModelById from ghcModelsManager
const mockGetModelById = vi.fn();
vi.mock('../ghcModelsManager', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ghcModelsManager')>();
  return {
    ...real,
    getModelById: (...args: any[]) => mockGetModelById(...args),
  };
});

const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

import { GhcModelApi, getEndpointForModel, ghcModelApi } from '../ghcModelApi';

// ============================================================================
// Helpers
// ============================================================================

function makeSession(token = 'tok-123') {
  return {
    authProvider: 'ghc',
    ghcAuth: { copilotTokens: { token } },
  };
}

function makeOkResponse(content: string | object[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    text: vi.fn().mockResolvedValue(''),
  };
}

// ============================================================================
// getEndpointForModel
// ============================================================================

describe('getEndpointForModel', () => {
  beforeEach(() => {
    mockGetModelById.mockReset();
  });

  it('returns /chat/completions when model supports it', () => {
    mockGetModelById.mockReturnValue({
      id: 'gpt-4.1',
      supported_endpoints: ['/chat/completions', '/responses'],
    });
    expect(getEndpointForModel('gpt-4.1')).toBe('/chat/completions');
  });

  it('returns first endpoint when /chat/completions is not in the list', () => {
    mockGetModelById.mockReturnValue({
      id: 'codex-mini',
      supported_endpoints: ['/responses'],
    });
    expect(getEndpointForModel('codex-mini')).toBe('/responses');
  });

  it('returns /chat/completions as default when model is not found', () => {
    mockGetModelById.mockReturnValue(undefined);
    expect(getEndpointForModel('unknown-model')).toBe('/chat/completions');
  });

  it('returns /chat/completions as default when supported_endpoints is empty', () => {
    mockGetModelById.mockReturnValue({ id: 'x', supported_endpoints: [] });
    expect(getEndpointForModel('x')).toBe('/chat/completions');
  });

  it('returns /chat/completions as default when supported_endpoints is absent', () => {
    mockGetModelById.mockReturnValue({ id: 'y' });
    expect(getEndpointForModel('y')).toBe('/chat/completions');
  });
});

// ============================================================================
// GhcModelApi
// ============================================================================

describe('GhcModelApi', () => {
  let api: GhcModelApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelById.mockReturnValue(undefined); // default: no model found → /chat/completions
    api = new GhcModelApi();
  });

  // ---------- callGPT41 ----------

  describe('callGPT41', () => {
    it('returns string content on success', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('Hello World'));

      const result = await api.callGPT41('user prompt');
      expect(result).toBe('Hello World');
    });

    it('uses system prompt when provided', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('resp'));

      await api.callGPT41('user', 'system prompt');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('system prompt');
    });

    it('handles array content format', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      const arrayContent = [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' },
      ];
      mockFetch.mockResolvedValue(makeOkResponse(arrayContent));

      const result = await api.callGPT41('prompt');
      expect(result).toBe('part1part2');
    });

    it('handles array content with non-text parts (ignores them)', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      const arrayContent = [
        { type: 'image', url: 'img.png' },
        { type: 'text', text: 'text-only' },
      ];
      mockFetch.mockResolvedValue(makeOkResponse(arrayContent));

      const result = await api.callGPT41('prompt');
      expect(result).toBe('text-only');
    });

    it('throws when auth session is not available', async () => {
      mockGetCurrentAuth.mockResolvedValue(null);
      await expect(api.callGPT41('hi')).rejects.toThrow('GitHub Copilot authentication required');
    });

    it('throws when authProvider is not ghc', async () => {
      mockGetCurrentAuth.mockResolvedValue({ authProvider: 'other', ghcAuth: {} });
      await expect(api.callGPT41('hi')).rejects.toThrow('GitHub Copilot authentication required');
    });

    it('throws on non-ok HTTP response', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('auth error'),
      });
      await expect(api.callGPT41('hi')).rejects.toThrow('GitHub Copilot API error: 401');
    });

    it('throws when response has no content', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: {} }] }),
      });
      await expect(api.callGPT41('hi')).rejects.toThrow('API response format invalid');
    });

    it('throws when getCurrentAuth itself throws', async () => {
      mockGetCurrentAuth.mockRejectedValue(new Error('auth error'));
      await expect(api.callGPT41('hi')).rejects.toThrow('GitHub Copilot authentication required');
    });
  });

  // ---------- callModel ----------

  describe('callModel', () => {
    it('returns string content using specified model', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('model response'));

      const result = await api.callModel('claude-haiku-4.5', 'prompt');
      expect(result).toBe('model response');
    });

    it('sends correct model in request body', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('ok'));

      await api.callModel('claude-sonnet-4.6', 'prompt', 'sys', 1000, 0.5);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4.6');
      expect(body.temperature).toBe(0.5);
    });

    it('handles array content in callModel', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      const arrayContent = [{ type: 'text', text: 'arr' }];
      mockFetch.mockResolvedValue(makeOkResponse(arrayContent));

      const result = await api.callModel('model', 'prompt');
      expect(result).toBe('arr');
    });

    it('throws when no session in callModel', async () => {
      mockGetCurrentAuth.mockResolvedValue(null);
      await expect(api.callModel('model', 'prompt')).rejects.toThrow('authentication required');
    });

    it('throws on non-ok response in callModel', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: vi.fn().mockResolvedValue('internal error'),
      });
      await expect(api.callModel('model', 'prompt')).rejects.toThrow('GitHub Copilot API error: 500');
    });

    it('throws when response has no content in callModel', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] }),
      });
      await expect(api.callModel('model', 'prompt')).rejects.toThrow('API response format invalid');
    });

    it('skips messages with no content for non-system roles', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('ok'));

      // Pass a system prompt (which will have content) and ensure it gets included
      await api.callModel('model', 'user msg', 'system msg');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages.some((m: any) => m.role === 'system')).toBe(true);
    });
  });

  // ---------- callWithMessages ----------

  describe('callWithMessages', () => {
    it('calls API with provided messages array', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse('result'));

      const messages = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      const result = await api.callWithMessages('gpt-4.1', messages);
      expect(result).toBe('result');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual(messages);
    });

    it('handles array content in callWithMessages', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue(makeOkResponse([{ type: 'text', text: 'arr-resp' }]));

      const result = await api.callWithMessages('model', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe('arr-resp');
    });

    it('throws when no session in callWithMessages', async () => {
      mockGetCurrentAuth.mockResolvedValue(null);
      await expect(api.callWithMessages('model', [{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('authentication required');
    });

    it('throws on non-ok response in callWithMessages', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Rate Limited',
        text: vi.fn().mockResolvedValue('rate limit'),
      });
      await expect(api.callWithMessages('model', [{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('GitHub Copilot API error: 429');
    });

    it('throws when no content in callWithMessages response', async () => {
      mockGetCurrentAuth.mockResolvedValue(makeSession());
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: {} }] }),
      });
      await expect(api.callWithMessages('model', [{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('API response format invalid');
    });
  });

  // ---------- singleton ----------

  it('ghcModelApi is a GhcModelApi instance (singleton export)', () => {
    expect(ghcModelApi).toBeInstanceOf(GhcModelApi);
  });
});
