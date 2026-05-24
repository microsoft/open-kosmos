/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the image module used by dom.ts
vi.mock('../image', () => ({
  base64ToBlob: vi.fn((base64: string, type: string) => new Blob([base64], { type })),
}));

import {
  downloadUrl,
  setToClipboard,
  downloadCanvas,
  copyCanvas,
  svgString2Base64,
  svg2Base64,
  measureWidth,
  measureDomRect,
  waitWinSize,
} from '../dom';

describe('dom.ts', () => {
  describe('svgString2Base64', () => {
    it('encodes svg string as data URI', () => {
      const svg = '<svg><rect /></svg>';
      const result = svgString2Base64(svg);
      expect(result).toContain('data:image/svg+xml,');
      expect(result).toContain(encodeURIComponent(svg));
    });
  });

  describe('downloadUrl', () => {
    it('sets href and download, then clicks anchor', () => {
      const clickSpy = vi.fn();
      const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      const anchorProto = HTMLAnchorElement.prototype as any;
      const originalClick = anchorProto.click;
      anchorProto.click = clickSpy;

      downloadUrl('http://example.com/file.png', 'file.png');
      expect(clickSpy).toHaveBeenCalled();

      anchorProto.click = originalClick;
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe('setToClipboard', () => {
    it('uses clipboard API when available', async () => {
      const writeMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { write: writeMock },
        writable: true,
        configurable: true,
      });
      (window as any).ClipboardItem = class ClipboardItem {
        constructor(public data: any) {}
      };

      const blob = new Blob(['data'], { type: 'image/png' });
      await setToClipboard(blob);
      expect(writeMock).toHaveBeenCalled();
    });

    it('rejects when clipboard API is missing', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      (window as any).ClipboardItem = undefined;

      const blob = new Blob(['data'], { type: 'image/png' });
      await expect(setToClipboard(blob)).rejects.toThrow();
    });
  });

  describe('measureWidth', () => {
    it('returns computed width when valid', () => {
      const el = document.createElement('div');
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ width: '42.5px' } as any);
      expect(measureWidth(el)).toBe(43);
    });

    it('falls back to offsetWidth when computed width is NaN', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ width: 'auto' } as any);
      expect(measureWidth(el)).toBe(100);
    });
  });

  describe('measureDomRect', () => {
    it('returns width and height from getBoundingClientRect', () => {
      const el = document.createElement('div');
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100 } as DOMRect);
      const [w, h] = measureDomRect(el);
      expect(w).toBe(200);
      expect(h).toBe(100);
    });
  });

  describe('waitWinSize', () => {
    it('calls callback immediately when window has dimensions', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true });
      const cb = vi.fn();
      waitWinSize(cb);
      expect(cb).toHaveBeenCalledWith(1024, 768);
    });

    it('polls when window has no dimensions and eventually calls callback', () => {
      vi.useFakeTimers();
      let callCount = 0;
      const origInnerWidth = window.innerWidth;
      const origInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerWidth', { value: 0, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });

      const cb = vi.fn();
      waitWinSize(cb);
      expect(cb).not.toHaveBeenCalled();

      // Simulate window becoming ready
      Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true });

      vi.advanceTimersByTime(100);
      expect(cb).toHaveBeenCalledWith(800, 600);

      vi.useRealTimers();
      Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: origInnerHeight, writable: true, configurable: true });
    });
  });

  describe('downloadCanvas', () => {
    it('calls downloadUrl with canvas data URL', () => {
      const canvas = document.createElement('canvas');
      vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,abc');
      const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
      const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
      const clickSpy = vi.fn();
      HTMLAnchorElement.prototype.click = clickSpy;

      downloadCanvas(canvas, 'test.png');
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
      expect(clickSpy).toHaveBeenCalled();

      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe('copyCanvas', () => {
    it('calls setToClipboard and returns base64', async () => {
      const writeMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { write: writeMock },
        writable: true,
        configurable: true,
      });
      (window as any).ClipboardItem = class ClipboardItem {
        constructor(public data: any) {}
      };
      const canvas = document.createElement('canvas');
      vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,abc');

      const result = await copyCanvas(canvas);
      expect(result).toBe('data:image/png;base64,abc');
      expect(writeMock).toHaveBeenCalled();
    });
  });

  describe('svg2Base64', () => {
    it('serializes SVG element to base64 data URI', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const result = svg2Base64(svg);
      expect(result).toContain('data:image/svg+xml,');
    });
  });
});
