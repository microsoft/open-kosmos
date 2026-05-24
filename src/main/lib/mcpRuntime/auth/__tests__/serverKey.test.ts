/**
 * Tests for `getMcpOAuthServerKey`.
 *
 * The key is used to address per-server OAuth credential slots in
 * `OpenKosmosTokenCache.mcpOAuth`. Stability across functionally-equivalent
 * configs and invalidation on identity-changing edits is critical: a wrong
 * key would either cause silent credential reuse across servers or force
 * unnecessary re-auth on irrelevant config changes.
 */
import { describe, it, expect } from 'vitest';
import { getMcpOAuthServerKey } from '../serverKey';
import type { McpServerConfig } from '../../../userDataADO/types/profile';

function makeCfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'github',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://api.githubcopilot.com/mcp/',
    in_use: true,
    ...overrides,
  };
}

describe('getMcpOAuthServerKey', () => {
  it('produces the form `<name>|<16-hex-chars>`', () => {
    const key = getMcpOAuthServerKey('github', makeCfg());
    expect(key).toMatch(/^github\|[a-f0-9]{16}$/);
  });

  it('returns the same key for the same config', () => {
    const cfg = makeCfg();
    expect(getMcpOAuthServerKey('github', cfg)).toBe(getMcpOAuthServerKey('github', cfg));
  });

  it('is invariant to header insertion order', () => {
    const a = makeCfg({ headers: { 'X-A': '1', 'X-B': '2' } });
    const b = makeCfg({ headers: { 'X-B': '2', 'X-A': '1' } });
    expect(getMcpOAuthServerKey('github', a)).toBe(getMcpOAuthServerKey('github', b));
  });

  it('changes when URL changes', () => {
    const a = makeCfg({ url: 'https://a.example.com/mcp' });
    const b = makeCfg({ url: 'https://b.example.com/mcp' });
    expect(getMcpOAuthServerKey('s', a)).not.toBe(getMcpOAuthServerKey('s', b));
  });

  it('changes when an auth-relevant header changes', () => {
    const a = makeCfg({ headers: { Authorization: 'Bearer x' } });
    const b = makeCfg({ headers: { Authorization: 'Bearer y' } });
    expect(getMcpOAuthServerKey('s', a)).not.toBe(getMcpOAuthServerKey('s', b));
  });

  it('changes when oauth.clientId changes', () => {
    const a = makeCfg({ oauth: { clientId: 'a' } });
    const b = makeCfg({ oauth: { clientId: 'b' } });
    expect(getMcpOAuthServerKey('s', a)).not.toBe(getMcpOAuthServerKey('s', b));
  });

  it('does NOT change when only oauth.clientSecret changes', () => {
    // Rotating a client secret should not invalidate previously-stored tokens.
    const a = makeCfg({ oauth: { clientId: 'fixed', clientSecret: 'old' } });
    const b = makeCfg({ oauth: { clientId: 'fixed', clientSecret: 'new' } });
    expect(getMcpOAuthServerKey('s', a)).toBe(getMcpOAuthServerKey('s', b));
  });

  it('does NOT change when only display fields change', () => {
    const a = makeCfg({ version: '1.0.0' });
    const b = makeCfg({ version: '2.0.0' });
    expect(getMcpOAuthServerKey('s', a)).toBe(getMcpOAuthServerKey('s', b));
  });

  it('changes when callbackPort changes (different redirect URI)', () => {
    const a = makeCfg({ oauth: { callbackPort: 33420 } });
    const b = makeCfg({ oauth: { callbackPort: 33421 } });
    expect(getMcpOAuthServerKey('s', a)).not.toBe(getMcpOAuthServerKey('s', b));
  });

  it('uses the supplied serverName as the prefix', () => {
    const cfg = makeCfg();
    expect(getMcpOAuthServerKey('alpha', cfg).startsWith('alpha|')).toBe(true);
    expect(getMcpOAuthServerKey('beta', cfg).startsWith('beta|')).toBe(true);
  });
});
