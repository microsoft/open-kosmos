/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock stylis
vi.mock('stylis', () => ({
  compile: (str: string) => [{ type: 'rule', value: str, props: [], children: [], line: 1, column: 1, length: str.length, return: '' }],
  stringify: (rule: any, _i: any, _rules: any, stringifier: any) => `.test { color: red; }`,
}));

describe('styled', () => {
  let mod: typeof import('../styled');

  beforeAll(async () => {
    // Ensure document.head has the required DOM
    mod = await import('../styled');
  });

  it('css returns a class string starting with s-', () => {
    const cls = mod.css`color: red;`;
    expect(typeof cls).toBe('string');
    expect(cls).toMatch(/^s-/);
  });

  it('css accepts interpolated values', () => {
    const color = 'blue';
    const size = 12;
    const cls = mod.css`color: ${color}; font-size: ${size}px;`;
    expect(typeof cls).toBe('string');
  });

  it('keyframes returns a keyframes name string', () => {
    const name = mod.keyframes`
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    `;
    expect(typeof name).toBe('string');
    expect(name).toMatch(/^s-/);
  });

  it('istyled returns a function', () => {
    const styleFn = mod.istyled('.my-class');
    expect(typeof styleFn).toBe('function');
  });

  it('istyled function can be called with template literal', () => {
    const styleFn = mod.istyled('.my-class');
    expect(() => styleFn`color: green;`).not.toThrow();
  });
});
