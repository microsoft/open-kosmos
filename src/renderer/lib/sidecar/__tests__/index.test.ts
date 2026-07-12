/**
 * @vitest-environment happy-dom
 *
 * Smoke test for the sidecar lib barrel.
 */

import { describe, it, expect } from 'vitest';
import * as sidecar from '../index';

describe('sidecar lib barrel', () => {
  it('re-exports the generic cache and hook', () => {
    expect(sidecar.SidecarListCacheManager).toBeTypeOf('function');
    expect(sidecar.useSidecarList).toBeTypeOf('function');
  });
});
