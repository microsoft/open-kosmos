/**
 * Tests for `getProviderHelp` and `substituteStepPlaceholders`.
 */
import { describe, it, expect } from 'vitest';
import { getProviderHelp, substituteStepPlaceholders } from '../dcrFallbackInstructions';
import type { McpResolvedAuthMetadata } from '../types';
import type { McpServerConfig } from '../../../userDataADO/types/profile';

function md(overrides: Partial<McpResolvedAuthMetadata> = {}): McpResolvedAuthMetadata {
  return {
    authorizationServerUrl: 'https://github.com/login/oauth',
    authorizationServerMetadata: {
      issuer: 'https://github.com',
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
    },
    scopes: [],
    providerLabel: 'GitHub',
    telemetry: { resourceMetadataSource: 'none', serverMetadataSource: 'default' },
    ...overrides,
  };
}

function cfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 's', transport: 'StreamableHttp', command: '', args: [], env: {},
    url: 'https://x', in_use: true, ...overrides,
  };
}

describe('getProviderHelp - priority', () => {
  it('1. plugin author override wins', () => {
    const help = getProviderHelp(md(), cfg({
      oauth: {
        setupUrl: 'https://my.example.com/setup',
        setupInstructions: ['custom step 1', 'custom step 2'],
      },
    }));
    expect(help.setupUrl).toBe('https://my.example.com/setup');
    expect(help.steps).toEqual(['custom step 1', 'custom step 2']);
  });

  it('2. built-in catalog matches GitHub', () => {
    const help = getProviderHelp(md(), cfg());
    expect(help.label).toBe('GitHub');
    expect(help.setupUrl).toContain('github.com');
    expect(help.steps.some(s => s.includes('OAuth Apps'))).toBe(true);
  });

  it('2. built-in catalog matches Slack', () => {
    const help = getProviderHelp(md({
      authorizationServerUrl: 'https://slack.com',
      authorizationServerMetadata: { issuer: 'https://slack.com' },
    }), cfg());
    expect(help.label).toBe('Slack');
    expect(help.setupUrl).toContain('slack.com');
  });

  it('2. built-in catalog matches Atlassian', () => {
    const help = getProviderHelp(md({
      authorizationServerUrl: 'https://auth.atlassian.com',
      authorizationServerMetadata: { issuer: 'https://atlassian.com' },
    }), cfg());
    expect(help.label).toBe('Atlassian');
  });

  it('3. unknown issuer falls back to generic guidance', () => {
    const help = getProviderHelp(md({
      authorizationServerUrl: 'https://auth.example.invalid',
      authorizationServerMetadata: { issuer: 'https://auth.example.invalid' },
      providerLabel: 'Identity Provider',
    }), cfg());
    expect(help.setupUrl).toBeUndefined();
    expect(help.steps.length).toBeGreaterThan(0);
    // Generic guidance must mention the redirect URI placeholder so the
    // dialog can substitute it at render time.
    expect(help.steps.some(s => s.includes('{redirectUri}'))).toBe(true);
  });

  it('overrides win even for built-in providers', () => {
    const help = getProviderHelp(md() /* GitHub */, cfg({
      oauth: { setupInstructions: ['only step'] },
    }));
    expect(help.steps).toEqual(['only step']);
  });
});

describe('substituteStepPlaceholders', () => {
  it('substitutes {redirectUri} and {serverName}', () => {
    expect(substituteStepPlaceholders(
      'Set callback to {redirectUri} for {serverName}.',
      { redirectUri: 'http://127.0.0.1:33420/callback', serverName: 'gh' },
    )).toBe('Set callback to http://127.0.0.1:33420/callback for gh.');
  });

  it('substitutes multiple occurrences', () => {
    expect(substituteStepPlaceholders(
      '{redirectUri} and {redirectUri}',
      { redirectUri: 'X', serverName: 's' },
    )).toBe('X and X');
  });

  it('leaves other braces untouched', () => {
    expect(substituteStepPlaceholders(
      'name = {name}, url = {redirectUri}',
      { redirectUri: 'X', serverName: 's' },
    )).toBe('name = {name}, url = X');
  });
});
