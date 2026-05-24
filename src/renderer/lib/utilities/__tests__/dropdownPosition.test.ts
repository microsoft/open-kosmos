/**
 * @vitest-environment happy-dom
 */

import {
  adjustAnchoredDropdownToViewport,
  getAnchoredDropdownPosition,
  getContextMenuPosition,
  clampMenuToViewport,
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  CONTEXT_MENU_SIZE_PRESETS,
} from '../dropdownPosition';

describe('dropdownPosition', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    });
  });

  describe('ANCHORED_DROPDOWN_SIZE_PRESETS', () => {
    it('has expected presets', () => {
      expect(ANCHORED_DROPDOWN_SIZE_PRESETS.agentMenu).toBeDefined();
      expect(ANCHORED_DROPDOWN_SIZE_PRESETS.agentMenu.estimatedWidth).toBeGreaterThan(0);
    });
  });

  describe('CONTEXT_MENU_SIZE_PRESETS', () => {
    it('has expected presets', () => {
      expect(CONTEXT_MENU_SIZE_PRESETS.imageGalleryMenu).toBeDefined();
    });
  });

  describe('getAnchoredDropdownPosition', () => {
    function makeButton(rect: Partial<DOMRect>): HTMLElement {
      const el = document.createElement('button');
      el.getBoundingClientRect = () => ({
        top: 100, bottom: 130, left: 200, right: 300, width: 100, height: 30,
        x: 200, y: 100, toJSON: () => ({}),
        ...rect,
      } as DOMRect);
      return el;
    }

    it('positions dropdown below button by default', () => {
      const pos = getAnchoredDropdownPosition(makeButton({}));
      expect(pos.top).toBe(134); // bottom + offset(4)
      expect(pos.triggerTop).toBe(100);
      expect(pos.triggerBottom).toBe(130);
      expect(pos.triggerRight).toBe(300);
    });

    it('flips above when not enough room below', () => {
      const pos = getAnchoredDropdownPosition(
        makeButton({ top: 700, bottom: 730 }),
        { estimatedHeight: 200 },
      );
      expect(pos.top).toBeLessThan(700);
    });

    it('clamps left to padding when button is near left edge', () => {
      const pos = getAnchoredDropdownPosition(
        makeButton({ right: 50, left: 0 }),
        { estimatedWidth: 300 },
      );
      expect(pos.left).toBeGreaterThanOrEqual(8);
    });

    it('clamps right to window edge', () => {
      const pos = getAnchoredDropdownPosition(
        makeButton({ right: 1020 }),
        { estimatedWidth: 200 },
      );
      expect(pos.left + 200).toBeLessThanOrEqual(1024);
    });

    it('uses default options when none provided', () => {
      const pos = getAnchoredDropdownPosition(makeButton({}));
      expect(pos).toBeDefined();
    });
  });

  describe('getContextMenuPosition', () => {
    it('positions at click coordinates when space available', () => {
      const pos = getContextMenuPosition(100, 200);
      expect(pos.left).toBe(100);
      expect(pos.top).toBe(200);
    });

    it('clamps when click is near right edge', () => {
      const pos = getContextMenuPosition(900, 100, { estimatedWidth: 200 });
      expect(pos.left + 200).toBeLessThanOrEqual(1024);
    });

    it('clamps when click is near bottom edge', () => {
      const pos = getContextMenuPosition(100, 700, { estimatedHeight: 200 });
      expect(pos.top + 200).toBeLessThanOrEqual(768);
    });

    it('clamps left to padding for negative x', () => {
      const pos = getContextMenuPosition(-10, 100);
      expect(pos.left).toBeGreaterThanOrEqual(8);
    });

    it('clamps top to padding for negative y', () => {
      const pos = getContextMenuPosition(100, -10);
      expect(pos.top).toBeGreaterThanOrEqual(8);
    });

    it('uses default options', () => {
      const pos = getContextMenuPosition(500, 400);
      expect(pos).toBeDefined();
    });
  });

  describe('adjustAnchoredDropdownToViewport', () => {
    function makeElement(rect: Partial<DOMRect>): HTMLElement {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => ({
        top: 140, bottom: 260, left: 100, right: 300, width: 200, height: 120,
        x: 100, y: 140, toJSON: () => ({}),
        ...rect,
      } as DOMRect);
      return el;
    }

    it('moves an above-menu back below when rendered menu fits below', () => {
      // isCurrentlyAbove = true (top < triggerTop), fitsBelow = true
      // triggerBottom + offset + height <= windowHeight - padding
      // 230 + 4 + 120 = 354 <= 768 - 10 = 758 ✓
      const el = makeElement({ top: 50, bottom: 170, height: 120, width: 240 });
      adjustAnchoredDropdownToViewport(el, {
        top: 50,
        left: 60,
        triggerTop: 200,
        triggerBottom: 230,
        triggerRight: 300,
      });
      // Should flip below: triggerBottom + offset = 230 + 4 = 234
      expect(el.style.top).toBe('234px');
    });

    it('keeps menu above when it still does not fit below', () => {
      // isCurrentlyAbove = true, fitsBelow = false
      // triggerBottom + offset + height > windowHeight - padding
      // 640 + 4 + 220 = 864 > 758 → does NOT fit below
      const el = makeElement({ top: 396, bottom: 616, height: 220, width: 240 });
      adjustAnchoredDropdownToViewport(el, {
        top: 396,
        left: 60,
        triggerTop: 620,
        triggerBottom: 640,
        triggerRight: 300,
      });
      expect(el.style.top).toBe('396px');
    });

    it('flips above when below but does not fit, and fits above', () => {
      // isCurrentlyAbove = false (top >= triggerTop), fitsBelow = false, fitsAbove = true
      const el = makeElement({ top: 650, bottom: 770, height: 120, width: 200 });
      adjustAnchoredDropdownToViewport(el, {
        top: 650,
        left: 100,
        triggerTop: 620,
        triggerBottom: 650,
        triggerRight: 300,
      });
      // Should flip above: triggerTop - height - offset = 620 - 120 - 4 = 496
      expect(el.style.top).toBe('496px');
    });

    it('clamps to bottom when element extends past viewport bottom', () => {
      // Not above, not fits below, not fits above, but rect.bottom > windowHeight - padding
      Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true, writable: true });
      const el = makeElement({ top: 300, bottom: 420, height: 120, width: 200 });
      adjustAnchoredDropdownToViewport(el, {
        top: 300,
        left: 100,
        triggerTop: 250,
        triggerBottom: 280,
        triggerRight: 300,
      });
      // Should clamp: max(padding, windowHeight - height - padding) = max(10, 400 - 120 - 10) = 270
      expect(parseInt(el.style.top)).toBeLessThanOrEqual(390);
    });

    it('clamps top to padding when element is above viewport', () => {
      const el = makeElement({ top: -5, bottom: 115, height: 120, width: 200 });
      adjustAnchoredDropdownToViewport(el, {
        top: -5,
        left: 100,
        triggerTop: 200,
        triggerBottom: 230,
        triggerRight: 300,
      });
      expect(parseInt(el.style.top)).toBeGreaterThanOrEqual(10);
    });

    it('handles missing triggerBottom', () => {
      const el = makeElement({ top: 140, bottom: 260, height: 120, width: 200 });
      adjustAnchoredDropdownToViewport(el, {
        top: 140,
        left: 100,
        triggerTop: 100,
        triggerRight: 300,
      });
      expect(el.style.top).toBeTruthy();
    });
  });

  describe('clampMenuToViewport', () => {
    function makeElement(rect: Partial<DOMRect>): HTMLElement {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => ({
        top: 100, bottom: 220, left: 100, right: 300, width: 200, height: 120,
        x: 100, y: 100, toJSON: () => ({}),
        ...rect,
      } as DOMRect);
      return el;
    }

    it('does nothing when element fits in viewport', () => {
      const el = makeElement({});
      clampMenuToViewport(el);
      expect(el.style.left).toBe('');
      expect(el.style.top).toBe('');
    });

    it('clamps right overflow', () => {
      const el = makeElement({ right: 1020, left: 820, width: 200 });
      clampMenuToViewport(el);
      expect(el.style.left).toBeTruthy();
    });

    it('clamps bottom overflow', () => {
      const el = makeElement({ bottom: 770, top: 650, height: 120 });
      clampMenuToViewport(el);
      expect(el.style.top).toBeTruthy();
    });

    it('clamps left overflow', () => {
      const el = makeElement({ left: 5 });
      clampMenuToViewport(el);
      expect(el.style.left).toBe('10px');
    });

    it('clamps top overflow', () => {
      const el = makeElement({ top: 5 });
      clampMenuToViewport(el);
      expect(el.style.top).toBe('10px');
    });
  });
});
