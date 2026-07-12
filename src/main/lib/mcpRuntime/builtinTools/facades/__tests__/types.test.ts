/**
 * Unit tests for facade types utility functions
 */

import { describe, it, expect } from 'vitest';
import { ok, fail, errorResult, normalizeStringArray } from '../types';

describe('types utilities', () => {
  describe('ok()', () => {
    it('returns { ok: true }', () => {
      expect(ok()).toEqual({ ok: true });
    });
  });

  describe('fail()', () => {
    it('returns { ok: false, message }', () => {
      expect(fail('oops')).toEqual({ ok: false, message: 'oops' });
    });

    it('includes hint when provided', () => {
      expect(fail('oops', 'try this')).toEqual({ ok: false, message: 'oops', hint: 'try this' });
    });
  });

  describe('errorResult()', () => {
    it('returns { success: false, message }', () => {
      const r = errorResult('bad');
      expect(r.success).toBe(false);
      expect(r.message).toBe('bad');
    });

    it('mirrors message into error and carries hint when provided', () => {
      const r = errorResult('bad', 'fix it');
      expect(r.error).toBe('bad');
      expect(r.hint).toBe('fix it');
    });
  });

  describe('normalizeStringArray()', () => {
    it('returns [] for undefined input', () => {
      expect(normalizeStringArray(undefined)).toEqual([]);
    });

    it('returns [] for non-array input', () => {
      expect(normalizeStringArray('nope' as unknown as string[])).toEqual([]);
    });

    it('trims, drops empties, and dedups', () => {
      expect(normalizeStringArray(['  a ', 'a', '', '  ', 'b'])).toEqual(['a', 'b']);
    });

    it('coerces non-string elements to empty and drops them', () => {
      // Exercises the `typeof s === 'string' ? ... : ''` false branch.
      expect(
        normalizeStringArray([null, 42, { x: 1 }, 'keep'] as unknown as string[]),
      ).toEqual(['keep']);
    });
  });

  describe('normalizeStringArray()', () => {
    it('returns [] for undefined input', () => {
      expect(normalizeStringArray(undefined)).toEqual([]);
    });

    it('returns [] for a non-array input', () => {
      // @ts-expect-error intentional invalid input to exercise the guard
      expect(normalizeStringArray('not-an-array')).toEqual([]);
    });

    it('trims, removes empties, and deduplicates', () => {
      expect(normalizeStringArray([' a ', 'a', 'b', '', '  '])).toEqual(['a', 'b']);
    });

    it('coerces non-string elements to empty and drops them', () => {
      // @ts-expect-error intentional mixed-type array to exercise the typeof branch
      expect(normalizeStringArray(['x', 42, null, undefined, {}, 'y'])).toEqual(['x', 'y']);
    });
  });
});

