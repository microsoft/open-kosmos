/**
 * Unit tests for facade types utility functions
 */

import { describe, it, expect } from 'vitest';
import { ok, fail, errorResult } from '../types';

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
  });
});
