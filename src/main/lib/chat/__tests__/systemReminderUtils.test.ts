import { describe, it, expect } from 'vitest';
import { wrapInSystemReminder } from '../systemReminderUtils';

describe('wrapInSystemReminder', () => {
  it('wraps non-empty content in system-reminder tags', () => {
    const result = wrapInSystemReminder('hello world');
    expect(result).toBe('<system-reminder>\nhello world\n</system-reminder>');
  });

  it('returns empty string unchanged', () => {
    expect(wrapInSystemReminder('')).toBe('');
  });

  it('preserves multi-line content', () => {
    const content = 'line1\nline2\nline3';
    const result = wrapInSystemReminder(content);
    expect(result).toBe('<system-reminder>\nline1\nline2\nline3\n</system-reminder>');
  });

  it('wraps content with leading/trailing whitespace as-is', () => {
    const result = wrapInSystemReminder('  spaced  ');
    expect(result).toContain('  spaced  ');
  });

  it('wraps content that already contains XML tags', () => {
    const content = '<foo>bar</foo>';
    const result = wrapInSystemReminder(content);
    expect(result).toBe('<system-reminder>\n<foo>bar</foo>\n</system-reminder>');
  });
});
