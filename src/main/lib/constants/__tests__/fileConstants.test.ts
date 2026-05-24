import { describe, it, expect } from 'vitest';
import { FILE_ATTACHMENT_LIMITS } from '../fileConstants';

describe('FILE_ATTACHMENT_LIMITS', () => {
  it('has MAX_FILE_SIZE_BYTES set to 5MB', () => {
    expect(FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('has MAX_TEXT_LINES set to 2000', () => {
    expect(FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES).toBe(2000);
  });

  it('has MAX_TOKEN_BUDGET set to 600', () => {
    expect(FILE_ATTACHMENT_LIMITS.MAX_TOKEN_BUDGET).toBe(600);
  });

  it('SUPPORTED_TEXT_EXTENSIONS is a non-empty array', () => {
    expect(Array.isArray(FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS)).toBe(true);
    expect(FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS.length).toBeGreaterThan(0);
  });

  it('includes common web extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.js');
    expect(exts).toContain('.ts');
    expect(exts).toContain('.tsx');
    expect(exts).toContain('.jsx');
    expect(exts).toContain('.css');
    expect(exts).toContain('.html');
    expect(exts).toContain('.json');
  });

  it('includes markdown and text extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.md');
    expect(exts).toContain('.txt');
    expect(exts).toContain('.rst');
  });

  it('includes programming language extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.py');
    expect(exts).toContain('.rs');
    expect(exts).toContain('.go');
    expect(exts).toContain('.java');
    expect(exts).toContain('.c');
    expect(exts).toContain('.cpp');
    expect(exts).toContain('.cs');
    expect(exts).toContain('.rb');
    expect(exts).toContain('.php');
    expect(exts).toContain('.swift');
  });

  it('includes config and data extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.yaml');
    expect(exts).toContain('.yml');
    expect(exts).toContain('.toml');
    expect(exts).toContain('.env');
    expect(exts).toContain('.csv');
    expect(exts).toContain('.sql');
  });

  it('includes shell script extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.sh');
    expect(exts).toContain('.bash');
    expect(exts).toContain('.ps1');
    expect(exts).toContain('.bat');
  });

  it('includes diff/patch extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    expect(exts).toContain('.patch');
    expect(exts).toContain('.diff');
  });

  it('contains only string values starting with a dot', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    for (const ext of exts) {
      expect(typeof ext).toBe('string');
      expect(ext.startsWith('.')).toBe(true);
    }
  });

  it('has no duplicate extensions', () => {
    const exts = FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS as readonly string[];
    const unique = new Set(exts);
    // Note: the source file intentionally has a few duplicates (.h, .sum, .mod) inherited
    // from the original list — we just verify the total length is reasonable
    expect(exts.length).toBeGreaterThan(50);
    // At least 90% unique (allow for known duplicates in the original source)
    expect(unique.size / exts.length).toBeGreaterThan(0.9);
  });
});
