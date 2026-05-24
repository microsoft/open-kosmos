import { describe, it, expect } from 'vitest';
import classnames from '../classnames';

describe('classnames', () => {
  it('joins string arguments', () => {
    expect(classnames('a', 'b', 'c')).toBe('a b c');
  });

  it('filters empty strings', () => {
    expect(classnames('a', '', 'c')).toBe('a c');
  });

  it('handles boolean values (filters falsy)', () => {
    expect(classnames('a', false, 'b')).toBe('a b');
    expect(classnames('a', true, 'b')).toBe('a b');
  });

  it('handles null and undefined', () => {
    expect(classnames('a', null, undefined, 'b')).toBe('a b');
  });

  it('handles object map — includes keys with truthy values', () => {
    expect(classnames({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('handles nested arrays', () => {
    expect(classnames(['a', 'b'], 'c')).toBe('a b c');
  });

  it('handles deeply nested arrays', () => {
    expect(classnames([['x', 'y'], 'z'])).toBe('x y z');
  });

  it('handles mixed args', () => {
    expect(classnames('base', { active: true, disabled: false }, ['extra'])).toBe('base active extra');
  });

  it('returns empty string for no truthy values', () => {
    expect(classnames(null, false, undefined, '')).toBe('');
  });
});
