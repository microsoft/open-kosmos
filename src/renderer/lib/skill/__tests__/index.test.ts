/**
 * @vitest-environment happy-dom
 *
 * Smoke test for the skill lib barrel.
 */

import { describe, it, expect } from 'vitest';

Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  writable: true,
  value: { profile: { onSkillsChanged: () => () => {} } },
});

import * as skill from '../index';

describe('skill lib barrel', () => {
  it('re-exports the cache and hook', () => {
    expect(skill.skillClientCacheManager).toBeDefined();
    expect(skill.useSkills).toBeTypeOf('function');
  });
});
