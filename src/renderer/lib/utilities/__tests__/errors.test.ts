import {
  GhcAuthError,
  GhcApiError,
  ProviderError,
  AuthProviderNotFoundError,
  ChatApiProviderNotFoundError,
} from '../errors';

describe('errors', () => {
  describe('GhcAuthError', () => {
    it('creates error with message and code', () => {
      const err = new GhcAuthError('auth failed', 'AUTH_001');
      expect(err.message).toBe('auth failed');
      expect(err.code).toBe('AUTH_001');
      expect(err.name).toBe('GhcAuthError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('GhcApiError', () => {
    it('creates error with message and statusCode', () => {
      const err = new GhcApiError('not found', 404);
      expect(err.message).toBe('not found');
      expect(err.statusCode).toBe(404);
      expect(err.name).toBe('GhcApiError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ProviderError', () => {
    it('creates error with message and provider', () => {
      const err = new ProviderError('something wrong', 'openai');
      expect(err.message).toBe('something wrong');
      expect(err.provider).toBe('openai');
      expect(err.name).toBe('ProviderError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('AuthProviderNotFoundError', () => {
    it('creates error with provider name in message', () => {
      const err = new AuthProviderNotFoundError('azure');
      expect(err.message).toContain('azure');
      expect(err.provider).toBe('azure');
      expect(err.name).toBe('AuthProviderNotFoundError');
      expect(err).toBeInstanceOf(ProviderError);
    });
  });

  describe('ChatApiProviderNotFoundError', () => {
    it('creates error with provider name in message', () => {
      const err = new ChatApiProviderNotFoundError('anthropic');
      expect(err.message).toContain('anthropic');
      expect(err.provider).toBe('anthropic');
      expect(err.name).toBe('ChatApiProviderNotFoundError');
      expect(err).toBeInstanceOf(ProviderError);
    });
  });
});
