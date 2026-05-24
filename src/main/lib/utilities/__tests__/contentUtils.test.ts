import { formatFileSize, formatLineCount } from '../contentUtils';

describe('formatFileSize', () => {
  it('returns "0 B" for zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('rounds to 2 decimal places', () => {
    expect(formatFileSize(1234)).toBe('1.21 KB');
  });
});

describe('formatLineCount', () => {
  it('returns singular form for 1 line', () => {
    expect(formatLineCount(1)).toBe('1 line');
  });

  it('returns plural form for multiple lines', () => {
    expect(formatLineCount(0)).toBe('0 lines');
    expect(formatLineCount(2)).toBe('2 lines');
    expect(formatLineCount(100)).toBe('100 lines');
  });

  it('localizes large numbers', () => {
    const result = formatLineCount(1000);
    // toLocaleString may produce "1,000" depending on locale
    expect(result).toContain('1');
    expect(result).toContain('lines');
  });
});
