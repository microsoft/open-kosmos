import { describe, expect, it } from 'vitest';
import { getProviderHelp } from '../dcrFallbackInstructions';
import type { McpResolvedAuthMetadata } from '../types';
import type { McpServerConfig } from '../../../userDataADO/types/profile';

function metadata(overrides: Partial<McpResolvedAuthMetadata> = {}): McpResolvedAuthMetadata {
  return {
    authorizationServerUrl: 'https://github.com/login/oauth',
    authorizationServerMetadata: {
      issuer: 'https://github.com',
    },
    scopes: [],
    providerLabel: 'GitHub',
    telemetry: { resourceMetadataSource: 'none', serverMetadataSource: 'default' },
    ...overrides,
  };
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'server',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://example.com/mcp',
    in_use: true,
    ...overrides,
  };
}

describe('dcrFallbackInstructions additional coverage', () => {
  it('falls back to generic steps when plugin authors provide only a setup URL', () => {
    const help = getProviderHelp(
      metadata({ providerLabel: 'Custom Provider' }),
      config({ oauth: { setupUrl: 'https://example.com/setup' } }),
    );

    expect(help.setupUrl).toBe('https://example.com/setup');
    expect(help.steps.some((step) => step.includes('{redirectUri}'))).toBe(true);
  });

  it('matches built-in providers even when issuer is absent', () => {
    const help = getProviderHelp(
      metadata({
        authorizationServerUrl: 'https://github.com/login/oauth',
        authorizationServerMetadata: {},
      }),
      config(),
    );

    expect(help.label).toBe('GitHub');
    expect(help.setupUrl).toContain('github.com');
  });
});
