// src/renderer/lib/errors.ts
export class GhcAuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'GhcAuthError';
  }
}

export class GhcApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'GhcApiError';
  }
}

export class ProviderError extends Error {
  constructor(message: string, public provider: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthProviderNotFoundError extends ProviderError {
  constructor(provider: string) {
    super(`Authentication provider not found: ${provider}`, provider);
    this.name = 'AuthProviderNotFoundError';
  }
}

export class ChatApiProviderNotFoundError extends ProviderError {
  constructor(provider: string) {
    super(`Chat API provider not found: ${provider}`, provider);
    this.name = 'ChatApiProviderNotFoundError';
  }
}