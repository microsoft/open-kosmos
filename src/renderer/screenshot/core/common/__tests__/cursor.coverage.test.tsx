/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

vi.mock('../utils/dom', () => ({
  svgString2Base64: (s: string) => 'data:image/svg+xml;base64,abc',
}));

describe('cursor', () => {
  let mod: typeof import('../cursor');

  beforeAll(async () => {
    mod = await import('../cursor');
  });

  it('exports default with pencil and mosaic functions', () => {
    expect(typeof mod.default.pencil).toBe('function');
    expect(typeof mod.default.mosaic).toBe('function');
  });

  it('pencil cursor returns a string for a color', () => {
    const result = mod.default.pencil('#ff0000');
    expect(typeof result).toBe('string');
    expect(result).toContain('url');
  });

  it('pencil cursor caches results', () => {
    const r1 = mod.default.pencil('#00ff00');
    const r2 = mod.default.pencil('#00ff00');
    expect(r1).toBe(r2);
  });

  it('mosaic cursor returns a string for a size', () => {
    const result = mod.default.mosaic(20);
    expect(typeof result).toBe('string');
    expect(result).toContain('url');
  });

  it('mosaic cursor caches results', () => {
    const r1 = mod.default.mosaic(30);
    const r2 = mod.default.mosaic(30);
    expect(r1).toBe(r2);
  });

  it('CrossCursor renders svg', () => {
    const { container } = render(<mod.CrossCursor size={20} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('TextCursor is a ReactElement', () => {
    expect(mod.TextCursor).toBeTruthy();
    const { container } = render(<>{mod.TextCursor}</>);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('PencilCursor renders svg', () => {
    const { container } = render(<mod.PencilCursor color="#ff0000" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('MosicCursor renders svg', () => {
    const { container } = render(<mod.MosicCursor size={24} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
