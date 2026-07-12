/**
 * Tests for the well-known OAuth provider catalog and the synthetic
 * metadata fetch wrapper.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  findWellKnownProvider,
  isKnownToNotSupportDcr,
  createSyntheticMetadataFetch,
  __getProvidersForTests,
} from '../wellKnownOAuthProviders';
import type { McpResolvedAuthMetadata } from '../types';

function md(overrides: Partial<McpResolvedAuthMetadata> = {}): McpResolvedAuthMetadata {
  return {
    authorizationServerUrl: 'https://example.invalid',
    authorizationServerMetadata: {
      issuer: 'https://example.invalid',
      authorization_endpoint: 'https://example.invalid/authorize',
      token_endpoint: 'https://example.invalid/token',
    },
    scopes: [],
    providerLabel: 'Identity Provider',
    telemetry: { resourceMetadataSource: 'none', serverMetadataSource: 'default' },
    ...overrides,
  };
}

describe('findWellKnownProvider', () => {
  it('matches GitHub by hostname', () => {
    const p = findWellKnownProvider(md({
      authorizationServerUrl: 'https://github.com/login/oauth',
      authorizationServerMetadata: { issuer: 'https://github.com' },
    }));
    expect(p?.label).toBe('GitHub');
    expect(p?.tokenEndpoint).toBe('https://github.com/login/oauth/access_token');
  });

  it('matches Slack', () => {
    const p = findWellKnownProvider(md({
      authorizationServerUrl: 'https://slack.com',
      authorizationServerMetadata: { issuer: 'https://slack.com' },
    }));
    expect(p?.label).toBe('Slack');
  });

  it('matches Google', () => {
    const p = findWellKnownProvider(md({
      authorizationServerUrl: 'https://accounts.google.com',
    }));
    expect(p?.label).toBe('Google');
  });

  it('returns undefined for unknown providers', () => {
    expect(findWellKnownProvider(md())).toBeUndefined();
  });
});

describe('isKnownToNotSupportDcr', () => {
  it('reports true for providers explicitly flagged as no-DCR', () => {
    const m = md({ authorizationServerUrl: 'https://github.com/login/oauth' });
    expect(isKnownToNotSupportDcr(m)).toBe(true);
  });

  it('returns false for unknown providers (caller proceeds with DCR probe)', () => {
    expect(isKnownToNotSupportDcr(md())).toBe(false);
  });

  it('every catalog entry is currently flagged dcrSupported=false', () => {
    // If we ever add a DCR-supporting provider, this assertion will trip
    // and the maintainer should re-evaluate the proactive short-circuit
    // logic in McpAuthService.
    for (const p of __getProvidersForTests()) {
      expect(p.dcrSupported).toBe(false);
    }
  });
});

describe('createSyntheticMetadataFetch', () => {
  it('intercepts well-known oauth-authorization-server probes for known providers', async () => {
    const innerFetch = vi.fn(async () => new Response('should not be called', { status: 500 }));
    const wrapped = createSyntheticMetadataFetch(innerFetch as any);

    const res = await wrapped('https://github.com/login/oauth/.well-known/oauth-authorization-server' as any);

    expect(innerFetch).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_endpoint).toBe('https://github.com/login/oauth/authorize');
    expect(body.token_endpoint).toBe('https://github.com/login/oauth/access_token');
    expect(body.response_types_supported).toContain('code');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  it('intercepts openid-configuration variant too', async () => {
    const innerFetch = vi.fn(async () => new Response('', { status: 500 }));
    const wrapped = createSyntheticMetadataFetch(innerFetch as any);

    const res = await wrapped('https://slack.com/.well-known/openid-configuration' as any);

    expect(innerFetch).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token_endpoint).toBe('https://slack.com/api/oauth.v2.access');
  });

  it('passes through unknown-provider metadata probes', async () => {
    const passthroughResponse = new Response('{}', { status: 200 });
    const innerFetch = vi.fn(async () => passthroughResponse);
    const wrapped = createSyntheticMetadataFetch(innerFetch as any);

    const res = await wrapped('https://stytch.example.com/.well-known/oauth-authorization-server' as any);

    expect(innerFetch).toHaveBeenCalledTimes(1);
    expect(res).toBe(passthroughResponse);
  });

  it('passes through non-metadata requests for known providers (e.g. token exchange)', async () => {
    const passthroughResponse = new Response('{"access_token":"x"}', { status: 200 });
    const innerFetch = vi.fn(async () => passthroughResponse);
    const wrapped = createSyntheticMetadataFetch(innerFetch as any);

    // Token exchange URL — not a well-known path, must pass through
    const res = await wrapped('https://github.com/login/oauth/access_token' as any, {
      method: 'POST',
      body: 'grant_type=authorization_code&code=abc',
    } as any);

    expect(innerFetch).toHaveBeenCalledTimes(1);
    expect(res).toBe(passthroughResponse);
  });
});
