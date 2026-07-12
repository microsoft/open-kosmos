/**
 * @vitest-environment happy-dom
 *
 * Smoke test for the hook lib barrel.
 */

import { describe, it, expect } from 'vitest';

Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  writable: true,
  value: { profile: { onHooksChanged: () => () => {} } },
});

import * as hook from '../index';

describe('hook lib barrel', () => {
  it('re-exports the cache and hook', () => {
    expect(hook.hookClientCacheManager).toBeDefined();
    expect(hook.useHooks).toBeTypeOf('function');
  });
});
