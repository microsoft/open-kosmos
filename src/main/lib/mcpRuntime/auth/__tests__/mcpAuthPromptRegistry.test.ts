/**
 * Tests for McpAuthPromptRegistry — the typed in-memory map of pending
 * auth prompts awaiting renderer responses.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mcpAuthPromptRegistry } from '../mcpAuthPromptRegistry';
import type { McpAuthConsentDecision } from '../mcpAuthPromptRegistry';

beforeEach(() => {
  mcpAuthPromptRegistry.__resetForTests();
});

describe('McpAuthPromptRegistry — consent handlers', () => {
  it('registers and takes a consent handler', () => {
    const handler = (d: McpAuthConsentDecision) => d;
    mcpAuthPromptRegistry.registerConsent('req-1', handler);
    const taken = mcpAuthPromptRegistry.takeConsent('req-1');
    expect(taken).toBe(handler);
  });

  it('takeConsent removes the handler so a second take returns undefined', () => {
    const handler = (d: McpAuthConsentDecision) => d;
    mcpAuthPromptRegistry.registerConsent('req-2', handler);
    mcpAuthPromptRegistry.takeConsent('req-2');
    expect(mcpAuthPromptRegistry.takeConsent('req-2')).toBeUndefined();
  });

  it('cancelConsent removes the handler', () => {
    const handler = (d: McpAuthConsentDecision) => d;
    mcpAuthPromptRegistry.registerConsent('req-3', handler);
    mcpAuthPromptRegistry.cancelConsent('req-3');
    expect(mcpAuthPromptRegistry.takeConsent('req-3')).toBeUndefined();
  });

  it('returns undefined for unknown requestId', () => {
    expect(mcpAuthPromptRegistry.takeConsent('no-such-id')).toBeUndefined();
  });

  it('__listConsentIdsForTests reflects registered ids', () => {
    mcpAuthPromptRegistry.registerConsent('a', () => {});
    mcpAuthPromptRegistry.registerConsent('b', () => {});
    expect(mcpAuthPromptRegistry.__listConsentIdsForTests()).toEqual(['a', 'b']);
  });

  it('__listConsentIdsForTests is empty after reset', () => {
    mcpAuthPromptRegistry.registerConsent('x', () => {});
    mcpAuthPromptRegistry.__resetForTests();
    expect(mcpAuthPromptRegistry.__listConsentIdsForTests()).toHaveLength(0);
  });
});

describe('McpAuthPromptRegistry — clientId handlers', () => {
  it('registers and takes a clientId handler', () => {
    const handler = (r: any) => r;
    mcpAuthPromptRegistry.registerClientId('cid-1', handler);
    const taken = mcpAuthPromptRegistry.takeClientId('cid-1');
    expect(taken).toBe(handler);
  });

  it('takeClientId removes the handler so a second take returns undefined', () => {
    const handler = (r: any) => r;
    mcpAuthPromptRegistry.registerClientId('cid-2', handler);
    mcpAuthPromptRegistry.takeClientId('cid-2');
    expect(mcpAuthPromptRegistry.takeClientId('cid-2')).toBeUndefined();
  });

  it('cancelClientId removes the handler', () => {
    const handler = (r: any) => r;
    mcpAuthPromptRegistry.registerClientId('cid-3', handler);
    mcpAuthPromptRegistry.cancelClientId('cid-3');
    expect(mcpAuthPromptRegistry.takeClientId('cid-3')).toBeUndefined();
  });

  it('returns undefined for unknown requestId', () => {
    expect(mcpAuthPromptRegistry.takeClientId('no-such-id')).toBeUndefined();
  });

  it('__listClientIdIdsForTests reflects registered ids', () => {
    mcpAuthPromptRegistry.registerClientId('p', () => {});
    mcpAuthPromptRegistry.registerClientId('q', () => {});
    expect(mcpAuthPromptRegistry.__listClientIdIdsForTests()).toEqual(['p', 'q']);
  });

  it('__resetForTests clears both maps', () => {
    mcpAuthPromptRegistry.registerConsent('c', () => {});
    mcpAuthPromptRegistry.registerClientId('k', () => {});
    mcpAuthPromptRegistry.__resetForTests();
    expect(mcpAuthPromptRegistry.__listConsentIdsForTests()).toHaveLength(0);
    expect(mcpAuthPromptRegistry.__listClientIdIdsForTests()).toHaveLength(0);
  });
});
