/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { adjustScrollForExpandedContent } from '../toolCallExpansionScroll';

function makeContainer(scrollTop = 0, rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-container-reverse';
  Object.defineProperty(el, 'scrollTop', {
    get: () => (el as any)._scrollTop ?? scrollTop,
    set: (v: number) => { (el as any)._scrollTop = v; },
    configurable: true,
  });
  el.getBoundingClientRect = () => ({
    top: rect.top ?? 0,
    bottom: rect.bottom ?? 600,
    left: 0,
    right: 800,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return el;
}

function makeElement(rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    top: rect.top ?? 100,
    bottom: rect.bottom ?? 200,
    left: 0,
    right: 800,
    width: 800,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return el;
}

describe('adjustScrollForExpandedContent', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = makeContainer(0, { top: 0, bottom: 600 });
    document.body.appendChild(container);
  });

  it('does nothing when no .chat-container-reverse ancestor exists', () => {
    // anchorElement has no chat-container-reverse parent
    const anchor = makeElement({ top: 100 });
    const target = makeElement({ top: 100, bottom: 200 });
    document.body.appendChild(anchor);
    // Should not throw
    adjustScrollForExpandedContent({
      anchorElement: anchor,
      targetElement: target,
      anchorTopBeforeToggle: 100,
    });
    document.body.removeChild(anchor);
  });

  it('adjusts scrollTop by anchorDiff when anchor moved more than 1px', () => {
    container.appendChild(makeElement()); // placeholder child
    const anchor = makeElement({ top: 150 }); // moved by 50px (before was 100)
    container.appendChild(anchor);

    adjustScrollForExpandedContent({
      anchorElement: anchor,
      targetElement: makeElement(),
      anchorTopBeforeToggle: 100,
    });

    expect((container as any)._scrollTop).toBe(50);
  });

  it('does not adjust scrollTop when anchorDiff <= 1px', () => {
    const anchor = makeElement({ top: 100.5 }); // diff = 0.5, within tolerance
    container.appendChild(anchor);
    const target = makeElement({ top: 100, bottom: 200 }); // inside container (0-600)

    adjustScrollForExpandedContent({
      anchorElement: anchor,
      targetElement: target,
      anchorTopBeforeToggle: 100,
    });

    // scrollTop remains 0 (target is within container bounds)
    expect((container as any)._scrollTop ?? 0).toBe(0);
  });

  it('scrolls down when target bottom is below container bottom', () => {
    const anchor = makeElement({ top: 100 }); // diff = 0, no anchor scroll
    container.appendChild(anchor);
    // target.bottom (700) > container.bottom (600)
    const target = makeElement({ top: 500, bottom: 700 });

    adjustScrollForExpandedContent({
      anchorElement: anchor,
      targetElement: target,
      anchorTopBeforeToggle: 100,
    });

    expect((container as any)._scrollTop).toBe(100); // 700 - 600
  });

  it('scrolls up when target top is above container top', () => {
    const anchor = makeElement({ top: 100 }); // diff = 0
    container.appendChild(anchor);
    // target.top (-50) < container.top (0)
    const target = makeElement({ top: -50, bottom: 50 });

    adjustScrollForExpandedContent({
      anchorElement: anchor,
      targetElement: target,
      anchorTopBeforeToggle: 100,
    });

    expect((container as any)._scrollTop).toBe(-50); // -= (0 - (-50)) = subtract 50 from 0
  });
});
