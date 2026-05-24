import { GhcApiError, AuthenticationError, NetworkError, ValidationError } from '../errors';
import { guessMimeFromFileName, identifyBufferType, detectMimeFromMagicBytes } from '../mimeUtils';
import { createRedactor, redactDeep, redactScheduleJson, redactRuntimeStateJson, redactFileContent, isTextFile } from '../redact';

describe('main/lib/utilities/errors', () => {
  it('GhcApiError has statusCode', () => {
    const err = new GhcApiError('not found', 404);
    expect(err.message).toBe('not found');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('GhcApiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('GhcApiError defaults statusCode to 500', () => {
    expect(new GhcApiError('error').statusCode).toBe(500);
  });

  it('AuthenticationError', () => {
    const err = new AuthenticationError('auth failed');
    expect(err.name).toBe('AuthenticationError');
    expect(err).toBeInstanceOf(Error);
  });

  it('NetworkError', () => {
    const err = new NetworkError('timeout');
    expect(err.name).toBe('NetworkError');
    expect(err).toBeInstanceOf(Error);
  });

  it('ValidationError', () => {
    const err = new ValidationError('invalid');
    expect(err.name).toBe('ValidationError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('main/lib/utilities/mimeUtils', () => {
  describe('guessMimeFromFileName', () => {
    it('returns mime for known extensions', () => {
      expect(guessMimeFromFileName('file.pdf')).toBe('application/pdf');
      expect(guessMimeFromFileName('file.ts')).toBe('text/typescript');
      expect(guessMimeFromFileName('file.py')).toBe('text/x-python');
      expect(guessMimeFromFileName('file.json')).toBe('application/json');
    });

    it('is case insensitive', () => {
      expect(guessMimeFromFileName('FILE.PDF')).toBe('application/pdf');
    });

    it('returns undefined for unknown extensions', () => {
      expect(guessMimeFromFileName('file.xyz999')).toBeUndefined();
    });
  });

  describe('identifyBufferType', () => {
    it('identifies PNG', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(identifyBufferType(buf).type).toBe('png');
      expect(identifyBufferType(buf).mime).toBe('image/png');
    });

    it('identifies JPEG', () => {
      const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0x00, 0x00]);
      expect(identifyBufferType(buf).type).toBe('jpeg');
    });

    it('identifies GIF', () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
      expect(identifyBufferType(buf).type).toBe('gif');
    });

    it('identifies WebP', () => {
      const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
      expect(identifyBufferType(buf).type).toBe('webp');
    });

    it('identifies ZIP', () => {
      const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      expect(identifyBufferType(buf).type).toBe('zip');
    });

    it('identifies PDF', () => {
      const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
      expect(identifyBufferType(buf).type).toBe('pdf');
    });

    it('identifies CDFV2/OLE2', () => {
      const buf = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
      expect(identifyBufferType(buf).type).toBe('cdfv2');
    });

    it('identifies HTML', () => {
      const buf = Buffer.from('<html><body>Hello</body></html>');
      expect(identifyBufferType(buf).type).toBe('html');
    });

    it('identifies XML', () => {
      const buf = Buffer.from('<?xml version="1.0"?>');
      expect(identifyBufferType(buf).type).toBe('xml');
    });

    it('identifies UTF-8 BOM', () => {
      const buf = Buffer.from([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F]);
      expect(identifyBufferType(buf).type).toBe('text-bom');
    });

    it('identifies JSON (starts with {)', () => {
      const buf = Buffer.from('{"key": "value"}');
      expect(identifyBufferType(buf).type).toBe('json');
    });

    it('identifies JSON (starts with [)', () => {
      const buf = Buffer.from('[1,2,3]');
      expect(identifyBufferType(buf).type).toBe('json');
    });

    it('returns unknown for small buffer', () => {
      const buf = Buffer.from([0x00, 0x01, 0x02]);
      expect(identifyBufferType(buf).type).toBe('unknown');
    });

    it('returns unknown for unrecognized bytes', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
      expect(identifyBufferType(buf).type).toBe('unknown');
    });

    it('returns unknown for buffer starting with < but not html or xml', () => {
      // Starts with '<' (0x3C) but contains neither '<!doctype', '<html', '<!-', nor '<?xml'
      const buf = Buffer.from('<svg width="100">');
      expect(identifyBufferType(buf).type).toBe('unknown');
    });
  });

  describe('detectMimeFromMagicBytes', () => {
    it('returns mime for known types', () => {
      const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(detectMimeFromMagicBytes(png)).toBe('image/png');
    });

    it('returns null for unknown/ambiguous', () => {
      const unknown = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      expect(detectMimeFromMagicBytes(unknown)).toBeNull();
    });
  });
});

describe('main/lib/utilities/redact', () => {
  describe('isTextFile', () => {
    it('returns true for text extensions', () => {
      expect(isTextFile('/path/file.json')).toBe(true);
      expect(isTextFile('file.log')).toBe(true);
      expect(isTextFile('file.txt')).toBe(true);
    });

    it('returns false for non-text extensions', () => {
      expect(isTextFile('file.png')).toBe(false);
      expect(isTextFile('file.exe')).toBe(false);
    });
  });

  describe('createRedactor', () => {
    it('redacts email addresses', () => {
      const redact = createRedactor();
      expect(redact('contact user@example.com now')).toContain('<EMAIL>');
    });

    it('redacts authorization headers', () => {
      const redact = createRedactor();
      expect(redact('Authorization: Bearer abc123')).toContain('<REDACTED>');
    });

    it('redacts GitHub tokens', () => {
      const redact = createRedactor();
      expect(redact('token: ghp_abcdefg123456')).toContain('<REDACTED>');
      expect(redact('token: gho_abcdefg123456')).toContain('<REDACTED>');
    });

    it('redacts user alias when provided', () => {
      const redact = createRedactor({ userAlias: 'johndoe' });
      expect(redact('User johndoe logged in')).toContain('<REDACTED_ALIAS>');
    });

    it('redacts alias in paths', () => {
      const redact = createRedactor({ userAlias: 'johndoe' });
      expect(redact('/profiles/johndoe/data')).toContain('<REDACTED_ALIAS>');
    });

    it('redacts sensitive key=value patterns', () => {
      const redact = createRedactor();
      expect(redact('API_KEY=secret123')).toContain('<REDACTED>');
    });
  });

  describe('redactDeep', () => {
    const redact = (s: string) => s.replace(/secret/g, '<REDACTED>');

    it('redacts strings', () => {
      expect(redactDeep('my secret', redact)).toBe('my <REDACTED>');
    });

    it('redacts arrays recursively', () => {
      expect(redactDeep(['secret'], redact)).toEqual(['<REDACTED>']);
    });

    it('redacts objects recursively', () => {
      expect(redactDeep({ key: 'secret' }, redact)).toEqual({ key: '<REDACTED>' });
    });

    it('passes through non-string primitives', () => {
      expect(redactDeep(42, redact)).toBe(42);
      expect(redactDeep(null, redact)).toBe(null);
      expect(redactDeep(true, redact)).toBe(true);
    });
  });

  describe('redactScheduleJson', () => {
    const redact = (s: string) => s;

    it('redacts sensitive fields in schedule jobs', () => {
      const input = JSON.stringify({
        schedulerJobs: [
          { id: '1', message: 'private data', name: 'my job', description: 'desc' },
        ],
      });
      const result = JSON.parse(redactScheduleJson(input, redact));
      expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
      expect(result.schedulerJobs[0].name).toBe('<REDACTED>');
      expect(result.schedulerJobs[0].description).toBe('<REDACTED>');
      expect(result.schedulerJobs[0].id).toBe('1');
    });

    it('falls back to text redaction on invalid JSON', () => {
      const mockRedact = vi.fn((s: string) => 'redacted');
      redactScheduleJson('invalid json{', mockRedact);
      expect(mockRedact).toHaveBeenCalledWith('invalid json{');
    });
  });

  describe('redactRuntimeStateJson', () => {
    const redact = (s: string) => s;

    it('redacts alias field', () => {
      const input = JSON.stringify({ alias: 'myalias', version: '1.0' });
      const result = JSON.parse(redactRuntimeStateJson(input, redact));
      expect(result.alias).toBe('<REDACTED_ALIAS>');
      expect(result.version).toBe('1.0');
    });

    it('falls back on invalid JSON', () => {
      const mockRedact = vi.fn((s: string) => 'x');
      redactRuntimeStateJson('not json', mockRedact);
      expect(mockRedact).toHaveBeenCalled();
    });
  });

  describe('redactFileContent', () => {
    const redact = (s: string) => `[redacted]${s}`;

    it('uses schedule redactor for schedule files', () => {
      const content = JSON.stringify({ schedulerJobs: [{ message: 'hi', id: '1' }] });
      const result = redactFileContent(content, 'profiles/user/schedules/202601.json', redact);
      expect(result).toContain('<REDACTED>');
    });

    it('uses runtime state redactor for runtime-state.json', () => {
      const content = JSON.stringify({ alias: 'me' });
      const result = redactFileContent(content, 'data/runtime-state.json', redact);
      expect(result).toContain('<REDACTED_ALIAS>');
    });

    it('uses generic redaction for other files', () => {
      const result = redactFileContent('some text', 'file.log', redact);
      expect(result).toBe('[redacted]some text');
    });
  });
});
