import { vi, describe, it, expect } from 'vitest';

// Mock the 'os' module so that userInfo() throws
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    userInfo: () => {
      throw new Error('not available on this system');
    },
  };
});

import { createRedactor } from '../redact';

describe('createRedactor when os.userInfo() throws', () => {
  it('still creates a working redactor (graceful fallback — no username redaction)', () => {
    // The buildLiteralReplacements catch block should silently swallow the error
    const redact = createRedactor();
    expect(redact('hello world')).toBe('hello world');
    expect(redact('user@example.com')).toContain('<EMAIL>');
  });
});
