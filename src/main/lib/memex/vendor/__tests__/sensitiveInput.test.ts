import { describe, it, expect } from 'vitest';
import {
  prepareMemexInput,
  formatWarnings,
  redactSensitiveText,
  maskSecretUrl,
  maskFlomoWebhookUrl,
} from '../lib/sensitiveInput';

// Direct unit tests for the vendored sensitive-input guard. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file. These
// fixtures use synthetic secrets that match the detector's shape but are not
// real credentials.

describe('prepareMemexInput', () => {
  it('accepts a plain query with no warnings', () => {
    const r = prepareMemexInput('how does auth work', 'query');
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.text).toBe('how does auth work');
  });

  it('rejects a query containing tokenized URL credentials', () => {
    const r = prepareMemexInput('see https://user:pass@example.com/x', 'query');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Sensitive input rejected/);
  });

  it('redacts tokenized URL credentials in content and warns', () => {
    const r = prepareMemexInput('clone https://user:pass@example.com/repo', 'content');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('<redacted>@');
    expect(r.warnings).toContain('Tokenized URL credentials were redacted before saving.');
  });

  it('rejects content containing a known secret token', () => {
    const r = prepareMemexInput('key is AKIA1234567890ABCDEF here', 'content');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Sensitive input rejected/);
  });

  it('rejects content containing a PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nABCDEF\n-----END RSA PRIVATE KEY-----';
    const r = prepareMemexInput(pem, 'content');
    expect(r.ok).toBe(false);
  });

  it('rejects a high-entropy Authorization Bearer header', () => {
    const r = prepareMemexInput(
      'Authorization: Bearer a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6',
      'content',
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a long but low-entropy Bearer header value', () => {
    // 30+ chars satisfies the Bearer regex, but an all-letter, no-digit value is
    // neither a JWT nor high-entropy, so it falls through the reject check.
    const r = prepareMemexInput(
      'Authorization: Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'content',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an env assignment with a high-entropy secret value', () => {
    const r = prepareMemexInput('API_TOKEN=a1B2c3D4e5F6g7H8i9J0k1L2', 'content');
    expect(r.ok).toBe(false);
  });

  it('warns when a query mentions a local credential path', () => {
    const r = prepareMemexInput('check ~/.aws/credentials', 'query');
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('Query mentions a local credential path; prefer abstract search terms.');
  });

  it('does not flag an env assignment with a placeholder value', () => {
    const r = prepareMemexInput('API_TOKEN=your-token', 'content');
    expect(r.ok).toBe(true);
  });

  it('does not flag a long all-x placeholder env value', () => {
    // >= 24 chars so it passes the length gate, but matches the placeholder
    // regex (x+), exercising the placeholder-rejection branch in the entropy check.
    const r = prepareMemexInput('API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxx', 'content');
    expect(r.ok).toBe(true);
  });

  it('does not flag a long env value missing digits', () => {
    // >= 24 chars, not a placeholder, but all letters (no digit) → not a secret.
    const r = prepareMemexInput('API_KEY=abcdefghijklmnopqrstuvwx', 'content');
    expect(r.ok).toBe(true);
  });
});

describe('formatWarnings', () => {
  it('prefixes each warning with "Warning:"', () => {
    expect(formatWarnings(['one', 'two'])).toBe('Warning: one\nWarning: two');
  });

  it('returns an empty string for no warnings', () => {
    expect(formatWarnings([])).toBe('');
  });
});

describe('redactSensitiveText', () => {
  it('masks tokenized URL credentials', () => {
    const out = redactSensitiveText('https://user:pass@example.com/x');
    expect(out).toContain('user:<redacted>@');
  });

  it('masks userinfo without a password', () => {
    const out = redactSensitiveText('https://token@example.com/x');
    expect(out).toContain('<redacted>@');
  });

  it('redacts a PEM private key block', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----';
    expect(redactSensitiveText(pem)).toContain('<PRIVATE_KEY_REDACTED>');
  });

  it('redacts a Bearer header value', () => {
    const out = redactSensitiveText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(out).toContain('Authorization: Bearer <redacted>');
  });

  it('redacts known secret token shapes', () => {
    expect(redactSensitiveText('AKIA1234567890ABCDEF')).toContain('<redacted>');
    expect(redactSensitiveText('ghp_' + 'a'.repeat(36))).toContain('<redacted>');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSensitiveText('just some words')).toBe('just some words');
  });
});

describe('maskSecretUrl', () => {
  it('delegates to redactSensitiveText', () => {
    expect(maskSecretUrl('https://user:pass@example.com')).toContain('<redacted>@');
  });
});

describe('maskFlomoWebhookUrl', () => {
  it('redacts the token segment of a flomo webhook URL', () => {
    const out = maskFlomoWebhookUrl('https://flomoapp.com/iwh/SECRETTOKEN/');
    expect(out).toBe('https://flomoapp.com/iwh/<redacted>/');
  });

  it('leaves non-flomo URLs untouched', () => {
    expect(maskFlomoWebhookUrl('https://example.com/iwh/x')).toBe('https://example.com/iwh/x');
  });
});
