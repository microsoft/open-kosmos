// @ts-nocheck
/**
 * Tests for TikTokenEncoder and EncoderCache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockEncode = vi.fn();
const mockDecode = vi.fn();
const mockGetEncoding = vi.fn(() => ({
  encode: mockEncode,
  decode: mockDecode,
}));

vi.mock('js-tiktoken', () => ({
  getEncoding: (...args: any[]) => mockGetEncoding(...args),
}));

import { TikTokenEncoder } from '../encoders/TikTokenEncoder';
import { EncoderCache } from '../encoders/EncoderCache';

describe('TikTokenEncoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncode.mockReturnValue([1, 2, 3]);
    mockDecode.mockReturnValue('decoded text');
    mockGetEncoding.mockReturnValue({ encode: mockEncode, decode: mockDecode });
  });

  it('defaults to cl100k_base encoding', () => {
    const encoder = new TikTokenEncoder();
    expect(encoder.getEncoding()).toBe('cl100k_base');
  });

  it('accepts o200k_base encoding', () => {
    const encoder = new TikTokenEncoder('o200k_base');
    expect(encoder.getEncoding()).toBe('o200k_base');
  });

  describe('encode', () => {
    it('returns encoded token array', () => {
      const encoder = new TikTokenEncoder();
      expect(encoder.encode('hello')).toEqual([1, 2, 3]);
    });

    it('initializes lazily and reuses the same instance', () => {
      const encoder = new TikTokenEncoder();
      expect(mockEncode).not.toHaveBeenCalled();
      encoder.encode('hi');
      encoder.encode('hi again');
      expect(mockEncode).toHaveBeenCalledTimes(2);
      // getEncoding (initialization) only called once
      expect(mockGetEncoding).toHaveBeenCalledTimes(1);
    });

    it('throws if encoder initialization returns null', () => {
      mockGetEncoding.mockReturnValueOnce(null as any);
      const encoder = new TikTokenEncoder();
      expect(() => encoder.encode('fail')).toThrow('Failed to initialize TikToken encoder');
    });

    it('passes allowedSpecial to the underlying encoder', () => {
      const encoder = new TikTokenEncoder();
      encoder.encode('hello', ['<|endoftext|>']);
      expect(mockEncode).toHaveBeenCalledWith('hello', ['<|endoftext|>']);
    });
  });

  describe('countTokens', () => {
    it('returns the length of the encoded token array', () => {
      mockEncode.mockReturnValue([10, 20, 30, 40]);
      const encoder = new TikTokenEncoder();
      expect(encoder.countTokens('test')).toBe(4);
    });
  });

  describe('decode', () => {
    it('returns decoded string', () => {
      const encoder = new TikTokenEncoder();
      encoder.encode('hi'); // initialize
      expect(encoder.decode([1, 2, 3])).toBe('decoded text');
    });

    it('throws if encoder initialization returns null during decode', () => {
      mockGetEncoding.mockReturnValueOnce(null as any);
      const encoder = new TikTokenEncoder();
      expect(() => encoder.decode([1, 2])).toThrow('Failed to initialize TikToken encoder');
    });
  });
});

describe('EncoderCache', () => {
  beforeEach(() => {
    EncoderCache.getInstance().clearAll();
    vi.clearAllMocks();
    mockGetEncoding.mockReturnValue({ encode: mockEncode, decode: mockDecode });
    mockEncode.mockReturnValue([1, 2, 3]);
  });

  it('returns the same singleton instance', () => {
    expect(EncoderCache.getInstance()).toBe(EncoderCache.getInstance());
  });

  it('creates a new encoder on first request', () => {
    const cache = EncoderCache.getInstance();
    expect(cache.getEncoder('cl100k_base')).toBeInstanceOf(TikTokenEncoder);
  });

  it('returns the same encoder for the same encoding key', () => {
    const cache = EncoderCache.getInstance();
    const enc1 = cache.getEncoder('cl100k_base');
    const enc2 = cache.getEncoder('cl100k_base');
    expect(enc1).toBe(enc2);
  });

  it('creates different encoders for different keys', () => {
    const cache = EncoderCache.getInstance();
    expect(cache.getEncoder('cl100k_base')).not.toBe(cache.getEncoder('o200k_base'));
  });

  it('defaults to cl100k_base when no encoding is specified', () => {
    expect(EncoderCache.getInstance().getEncoder().getEncoding()).toBe('cl100k_base');
  });

  it('size() reflects the number of cached encoders', () => {
    const cache = EncoderCache.getInstance();
    expect(cache.size()).toBe(0);
    cache.getEncoder('cl100k_base');
    expect(cache.size()).toBe(1);
    cache.getEncoder('o200k_base');
    expect(cache.size()).toBe(2);
  });

  it('clearAll() removes all cached encoders', () => {
    const cache = EncoderCache.getInstance();
    cache.getEncoder('cl100k_base');
    cache.getEncoder('o200k_base');
    cache.clearAll();
    expect(cache.size()).toBe(0);
  });
});
